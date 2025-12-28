/**
 * YouTube 多影片追蹤資料收集程式
 * 
 * 功能：
 * - 從 YouTube API 獲取多個影片的播放量統計
 * - 將數據儲存至 GitHub Gist
 * - 支援影片管理操作（新增、刪除、更新）
 */

const https = require('https');

// ==================== 環境變數管理 ====================
const config = {
    youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || null,
    gistId: process.env.GIST_ID?.trim() || null,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null,
    cronAuthToken: process.env.CRON_AUTH_TOKEN?.trim() || null,
    nodeEnv: process.env.NODE_ENV || 'development'
};

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

// 影片配置模組
const videosConfig = require('./videos-config');

// ==================== 工具函式 ====================

/**
 * 常數時間字串比較（防止時序攻擊）
 */
function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * 安全解析 JSON（支援字串和已解析物件）
 */
function safeJsonParse(input, fallback) {
    if (!input) return fallback;
    
    // 如果已經是物件，直接返回
    if (typeof input === 'object') {
        return input;
    }
    
    // 如果是字串，解析它
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch {
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * HTTP 請求封裝（支援重試機制）
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            
            // 4xx 客戶端錯誤不重試
            if (response.status >= 400 && response.status < 500) {
                const errorText = await response.text().catch(() => '');
                throw { status: response.status, message: errorText || `HTTP ${response.status}` };
            }
            
            // 5xx 伺服器錯誤可重試
            if (response.status >= 500) {
                if (attempt < maxRetries) {
                    const waitTime = 1000 * Math.pow(2, attempt);
                    console.warn(`伺服器錯誤 ${response.status}，${waitTime}ms 後重試 (${attempt}/${maxRetries})`);
                    await delay(waitTime);
                    continue;
                }
                throw { status: response.status, message: `伺服器錯誤: ${response.status}` };
            }
            
            return response;
        } catch (error) {
            if (error.status && error.status >= 400 && error.status < 500) {
                throw error;
            }
            if (attempt === maxRetries) {
                throw error;
            }
            const waitTime = 1000 * Math.pow(2, attempt);
            console.warn(`請求失敗，${waitTime}ms 後重試 (${attempt}/${maxRetries}): ${error.message}`);
            await delay(waitTime);
        }
    }
    throw new Error('重試次數耗盡');
}

/**
 * 驗證 YouTube 影片 ID 格式
 */
function validateVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/**
 * 去除字串前後空白
 */
function trimString(str) {
    return typeof str === 'string' ? str.trim() : str;
}

// ==================== 佇列管理（速率限制）====================
class RequestQueue {
    constructor(maxConcurrent = 2, baseDelay = 1000) {
        this.maxConcurrent = maxConcurrent;
        this.baseDelay = baseDelay;
        this.queue = [];
        this.active = 0;
    }

    async enqueue(fn) {
        return new Promise((resolve, reject) => {
            const execute = async () => {
                this.active++;
                try {
                    const result = await fn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    this.active--;
                    this.processQueue();
                }
            };
            this.queue.push(execute);
            this.processQueue();
        });
    }

    processQueue() {
        while (this.queue.length > 0 && this.active < this.maxConcurrent) {
            const execute = this.queue.shift();
            execute();
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const requestQueue = new RequestQueue(2, 1000);

// ==================== Gist 操作 ====================

/**
 * 讀取 Gist 數據
 */
async function fetchGist(gistId, githubToken) {
    const url = `https://api.github.com/gists/${gistId}`;
    const response = await fetchWithRetry(url, {
        headers: {
            'Authorization': `token ${githubToken}`,
            'User-Agent': 'YouTube-Multi-Tracker/2.0',
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`無法讀取 Gist: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    return response.json();
}

/**
 * 更新 Gist 檔案
 */
async function updateGist(gistId, githubToken, files, description) {
    const url = `https://api.github.com/gists/${gistId}`;
    
    const response = await fetchWithRetry(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'YouTube-Multi-Tracker/2.0',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
            description: description,
            files: files
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gist 更新失敗: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    return response.json();
}

// ==================== YouTube API 操作 ====================

/**
 * 獲取 YouTube 影片統計
 */
async function fetchVideoStats(videoId, apiKey) {
    const url = `${YOUTUBE_API_BASE}?id=${videoId}&part=statistics&key=${apiKey}`;
    
    const response = await fetchWithRetry(url, {
        headers: {
            'User-Agent': 'YouTube-Multi-Tracker/2.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`YouTube API 錯誤: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
        throw new Error('影片未找到或無法存取');
    }

    return {
        viewCount: parseInt(data.items[0].statistics.viewCount, 10)
    };
}

// ==================== 影片管理操作 ====================

/**
 * 處理影片管理請求
 */
async function handleVideoManagement(req, res) {
    const { action } = req.query;
    const body = safeJsonParse(req.body, {});

    // 驗證必要環境變數
    if (!config.gistId || !config.githubToken) {
        return res.status(500).json({
            success: false,
            error: '伺服器配置錯誤',
            code: 'MISSING_CONFIG',
            details: {
                gistId: !!config.gistId,
                githubToken: !!config.githubToken
            }
        });
    }

    try {
        switch (action) {
            case 'get': {
                const configData = await videosConfig.getVideoConfig();
                const videos = Object.values(configData.TRACKED_VIDEOS);
                
                return res.status(200).json({
                    success: true,
                    data: videos,
                    meta: {
                        total: videos.length,
                        timestamp: new Date().toISOString()
                    }
                });
            }

            case 'add': {
                const { id, name, description, color } = body;
                
                if (!id || !name) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少必要參數',
                        code: 'MISSING_PARAMS',
                        details: { id: !!id, name: !!name }
                    });
                }

                if (!validateVideoId(id)) {
                    return res.status(400).json({
                        success: false,
                        error: '無效的 YouTube 影片 ID 格式',
                        code: 'INVALID_VIDEO_ID',
                        details: { id, example: 'dQw4w9WgXcQ' }
                    });
                }

                const currentConfig = await videosConfig.getVideoConfig();
                const videoList = Object.values(currentConfig.TRACKED_VIDEOS);

                if (videoList.some(v => v.id === id)) {
                    return res.status(400).json({
                        success: false,
                        error: '影片 ID 已存在',
                        code: 'DUPLICATE_VIDEO_ID',
                        details: { id }
                    });
                }

                const newVideo = {
                    id: trimString(id),
                    name: trimString(name),
                    description: trimString(description) || `${name} - YouTube 影片播放量追蹤`,
                    color: trimString(color) || '#0070f3',
                    startDate: new Date().toISOString().split('T')[0]
                };

                const saveResult = await videosConfig.saveVideoConfig([...videoList, newVideo]);

                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '儲存配置失敗',
                        code: 'SAVE_FAILED'
                    });
                }

                return res.status(200).json({
                    success: true,
                    message: '影片添加成功',
                    data: newVideo,
                    meta: { total: videoList.length + 1 }
                });
            }

            case 'delete': {
                const { id } = body;

                if (!id) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少影片 ID',
                        code: 'MISSING_VIDEO_ID'
                    });
                }

                const currentConfig = await videosConfig.getVideoConfig();
                let videoList = Object.values(currentConfig.TRACKED_VIDEOS);

                if (videoList.length <= 1) {
                    return res.status(400).json({
                        success: false,
                        error: '至少需要保留一個追蹤影片',
                        code: 'CANNOT_DELETE_LAST'
                    });
                }

                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到',
                        code: 'VIDEO_NOT_FOUND',
                        details: { availableIds: videoList.map(v => v.id) }
                    });
                }

                const deletedVideo = videoList[index];
                const updatedList = videoList.filter((_, i) => i !== index);

                const saveResult = await videosConfig.saveVideoConfig(updatedList);

                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '刪除配置失敗',
                        code: 'DELETE_FAILED'
                    });
                }

                return res.status(200).json({
                    success: true,
                    message: '影片刪除成功',
                    data: deletedVideo,
                    meta: { remaining: updatedList.length }
                });
            }

            case 'update': {
                const { id, name, description, color } = body;

                if (!id) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少影片 ID',
                        code: 'MISSING_VIDEO_ID'
                    });
                }

                const currentConfig = await videosConfig.getVideoConfig();
                let videoList = Object.values(currentConfig.TRACKED_VIDEOS);

                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到',
                        code: 'VIDEO_NOT_FOUND'
                    });
                }

                const original = videoList[index];
                const updated = {
                    ...original,
                    name: name ? trimString(name) : original.name,
                    description: description !== undefined ? trimString(description) : original.description,
                    color: color ? trimString(color) : original.color
                };

                videoList[index] = updated;

                const saveResult = await videosConfig.saveVideoConfig(videoList);

                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '更新配置失敗',
                        code: 'UPDATE_FAILED'
                    });
                }

                return res.status(200).json({
                    success: true,
                    message: '影片更新成功',
                    data: {
                        before: original,
                        after: updated
                    }
                });
            }

            default:
                return res.status(400).json({
                    success: false,
                    error: '未知的操作類型',
                    code: 'UNKNOWN_ACTION',
                    details: {
                        allowedActions: ['get', 'add', 'delete', 'update'],
                        received: action
                    }
                });
        }
    } catch (error) {
        console.error('影片管理操作失敗:', error);
        return res.status(500).json({
            success: false,
            error: '內部伺服器錯誤',
            code: 'INTERNAL_ERROR',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== 主處理函式 ====================

module.exports = async function handler(req, res) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    req.requestId = requestId;

    try {
        // 優先處理影片管理操作
        const { action } = req.query;
        if (action === 'get' || action === 'add' || action === 'delete' || action === 'update') {
            console.log(`[${requestId}] 處理影片管理操作: ${action}`);
            return await handleVideoManagement(req, res);
        }

        // 驗證必要環境變數
        if (!config.youtubeApiKey || !config.gistId || !config.githubToken) {
            const missing = [];
            if (!config.youtubeApiKey) missing.push('YOUTUBE_API_KEY');
            if (!config.gistId) missing.push('GIST_ID');
            if (!config.githubToken) missing.push('GITHUB_TOKEN');
            
            console.error(`[${requestId}] 缺少必要環境變數: ${missing.join(', ')}`);
            
            return res.status(500).json({
                success: false,
                error: '伺服器配置錯誤',
                code: 'MISSING_ENV_VARS',
                details: {
                    missingVars: missing,
                    configuredVars: ['CRON_AUTH_TOKEN']
                }
            });
        }

        // 除錯模式
        if (req.query.debug === '1') {
            const authHeader = req.headers.authorization;
            const tokenFromQuery = req.query.token || req.query.auth;

            return res.status(200).json({
                success: true,
                debug: true,
                environment: {
                    nodeEnv: config.nodeEnv,
                    youtubeApiKey: config.youtubeApiKey ? '已設定' : '未設定',
                    gistId: config.gistId ? '已設定' : '未設定',
                    githubToken: config.githubToken ? '已設定' : '未設定',
                    cronAuthToken: config.cronAuthToken ? '已設定' : '未設定'
                },
                auth: {
                    received: {
                        header: authHeader || '(空)',
                        queryToken: tokenFromQuery ? '***' + tokenFromQuery.slice(-4) : '(空)'
                    }
                },
                timestamp: new Date().toISOString()
            });
        }

        // 驗證請求方法
        if (req.method !== 'GET' && req.method !== 'POST') {
            return res.status(405).json({
                success: false,
                error: 'Method not allowed',
                code: 'INVALID_METHOD'
            });
        }

        // 生產環境認證檢查
        if (config.nodeEnv === 'production') {
            const authHeader = req.headers.authorization;
            const tokenFromQuery = req.query.token || req.query.auth;
            
            const headerValid = authHeader && secureCompare(authHeader, `Bearer ${config.cronAuthToken}`);
            const queryValid = tokenFromQuery && secureCompare(tokenFromQuery, config.cronAuthToken);
            
            if (!headerValid && !queryValid) {
                console.error(`[${requestId}] 未授權的請求`);
                
                return res.status(401).json({
                    success: false,
                    error: '未授權',
                    code: 'UNAUTHORIZED',
                    hint: '請使用 Authorization header 或 URL 參數傳遞認證令牌'
                });
            }
        }

        // 獲取最新影片配置
        const videoConfig = await videosConfig.getVideoConfig();
        const TRACKED_VIDEOS = videoConfig.TRACKED_VIDEOS;
        const ALL_VIDEO_IDS = videoConfig.ALL_VIDEO_IDS;

        console.log(`[${requestId}] 載入配置，追蹤 ${ALL_VIDEO_IDS.length} 個影片`);

        // 讀取現有 Gist
        const gistData = await fetchGist(config.gistId, config.githubToken);
        const filesToUpdate = {};
        
        if (gistData.files) {
            Object.assign(filesToUpdate, gistData.files);
        }

        const results = [];

        // 處理每個影片
        for (const videoId of ALL_VIDEO_IDS) {
            await requestQueue.enqueue(async () => {
                try {
                    const videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);
                    console.log(`[${requestId}] 處理影片: ${videoInfo?.name || videoId} (${videoId})`);

                    // 獲取 YouTube 統計
                    const stats = await fetchVideoStats(videoId, config.youtubeApiKey);
                    const timestamp = Date.now();
                    const currentDate = new Date(timestamp).toISOString().split('T')[0];
                    const currentHour = new Date(timestamp).getHours();

                    console.log(`[${requestId}] ${videoInfo?.name || videoId}: ${stats.viewCount.toLocaleString()} 次觀看`);

                    // 讀取現有數據
                    const fileName = `youtube-data-${videoId}.json`;
                    let currentData = [];

                    if (filesToUpdate[fileName]?.content) {
                        try {
                            currentData = safeJsonParse(filesToUpdate[fileName].content, []);
                            if (!Array.isArray(currentData)) {
                                console.warn(`[${requestId}] ${fileName} 內容不是陣列`);
                                currentData = [];
                            }
                        } catch {
                            currentData = [];
                        }
                    }

                    // 舊格式遷移
                    if (videoId === 'm2ANkjMRuXc' && currentData.length === 0 && filesToUpdate['youtube-data.json']?.content) {
                        console.log(`[${requestId}] 遷移舊數據格式`);
                        const oldData = safeJsonParse(filesToUpdate['youtube-data.json'].content, []);
                        if (Array.isArray(oldData)) {
                            currentData = oldData.map(item => ({
                                timestamp: item.timestamp,
                                viewCount: item.viewCount,
                                date: item.date || new Date(item.timestamp).toISOString().split('T')[0],
                                hour: item.hour || new Date(item.timestamp).getHours(),
                                videoId,
                                videoName: videoInfo?.name || videoId
                            }));
                        }
                    }

                    // 添加新記錄
                    const newEntry = {
                        timestamp,
                        viewCount: stats.viewCount,
                        date: currentDate,
                        hour: currentHour,
                        videoId,
                        videoName: videoInfo?.name || videoId
                    };

                    currentData.push(newEntry);

                    // 清理 30 天前的舊數據
                    const thirtyDaysAgo = timestamp - 30 * 24 * 60 * 60 * 1000;
                    currentData = currentData.filter(item => item.timestamp > thirtyDaysAgo);

                    // 按時間排序
                    currentData.sort((a, b) => a.timestamp - b.timestamp);

                    // 準備更新
                    filesToUpdate[fileName] = {
                        content: JSON.stringify(currentData, null, 2)
                    };

                    results.push({
                        videoId,
                        success: true,
                        viewCount: stats.viewCount,
                        totalEntries: currentData.length,
                        videoName: videoInfo?.name || videoId,
                        timestamp: new Date(timestamp).toISOString()
                    });

                } catch (error) {
                    console.error(`[${requestId}] 處理影片 ${videoId} 失敗:`, error.message);
                    results.push({
                        videoId,
                        success: false,
                        error: error.message,
                        code: error.code || 'UNKNOWN_ERROR'
                    });
                }

                // API 請求間隔
                await requestQueue.delay(1000);
            });
        }

        // 更新 Gist
        console.log(`[${requestId}] 更新 Gist (${Object.keys(filesToUpdate).length} 個檔案)`);
        
        await updateGist(
            config.gistId,
            config.githubToken,
            filesToUpdate,
            `YouTube 多影片追蹤數據 (${ALL_VIDEO_IDS.length} 個影片)，更新: ${new Date().toISOString()}`
        );

        // 生成回應
        const successful = results.filter(r => r.success).length;
        const totalViews = results.filter(r => r.success).reduce((sum, r) => sum + r.viewCount, 0);
        const processingTime = Date.now() - startTime;

        const response = {
            success: true,
            message: `已處理 ${successful}/${ALL_VIDEO_IDS.length} 個影片`,
            meta: {
                processingTime: `${processingTime}ms`,
                requestId,
                timestamp: new Date().toISOString()
            },
            summary: {
                totalVideos: ALL_VIDEO_IDS.length,
                successful,
                failed: ALL_VIDEO_IDS.length - successful,
                totalViews,
                totalViewsFormatted: totalViews.toLocaleString()
            },
            data: results
        };

        console.log(`[${requestId}] 完成，處理時間: ${processingTime}ms`);

        return res.status(200).json(response);

    } catch (error) {
        console.error(`[${requestId}] 處理失敗:`, error);
        
        return res.status(500).json({
            success: false,
            error: '內部伺服器錯誤',
            code: 'INTERNAL_ERROR',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};
