/**
 * Chart Data API - 影片數據查詢端點
 * 
 * 功能：
 * - 提供影片播放量數據查詢
 * - 支援時間範圍、數據間隔篩選
 * - 計算統計資訊
 * - 統一 API 響應格式
 */

const videosConfig = require('./videos-config');

// ==================== 環境變數 ====================
const config = {
    gistId: process.env.GIST_ID?.trim() || null,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null
};

// ==================== 工具函式 ====================

/**
 * 安全解析 JSON
 */
function safeJsonParse(str, fallback) {
    if (!str || typeof str !== 'string') return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * 驗證 YouTube 影片 ID
 */
function validateVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/**
 * HTTP 請求封裝
 */
async function fetchGist(gistId, githubToken) {
    const url = `https://api.github.com/gists/${gistId}`;
    
    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${githubToken}`,
            'User-Agent': 'YouTube-Multi-Tracker/2.0',
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        throw new Error(`無法讀取 Gist: ${response.status}`);
    }

    return response.json();
}

/**
 * 計算影片統計資訊
 */
function calculateStatistics(allData, processedData) {
    if (!processedData || processedData.length === 0) {
        return null;
    }

    const sorted = [...processedData].sort((a, b) => a.timestamp - b.timestamp);
    const latest = sorted[sorted.length - 1];
    const earliest = sorted[0];

    const today = new Date().toDateString();
    const todayData = processedData.filter(item => 
        new Date(item.timestamp).toDateString() === today
    );

    const last24h = processedData.filter(item => 
        Date.now() - item.timestamp < 24 * 60 * 60 * 1000
    );

    const totalChange = latest.viewCount - earliest.viewCount;
    const totalChangePercent = earliest.viewCount > 0 
        ? (totalChange / earliest.viewCount * 100).toFixed(2)
        : 0;

    return {
        summary: {
            totalRecords: allData.length,
            filteredRecords: processedData.length,
            dateRange: {
                start: new Date(processedData[0].timestamp).toISOString(),
                end: new Date(processedData[processedData.length - 1].timestamp).toISOString()
            }
        },
        current: {
            viewCount: latest.viewCount,
            timestamp: latest.timestamp,
            date: new Date(latest.timestamp).toISOString()
        },
        changes: {
            totalChange,
            totalChangePercent,
            todayChange: todayData.length > 1 
                ? todayData[todayData.length - 1].viewCount - todayData[0].viewCount 
                : 0,
            avgHourlyChange: last24h.length > 1
                ? Math.round((last24h[last24h.length - 1].viewCount - last24h[0].viewCount) / (last24h.length - 1))
                : 0
        },
        peaks: {
            maxViewCount: Math.max(...processedData.map(d => d.viewCount)),
            minViewCount: Math.min(...processedData.map(d => d.viewCount)),
            avgViewCount: Math.round(processedData.reduce((sum, d) => sum + d.viewCount, 0) / processedData.length)
        }
    };
}

// ==================== 主處理函式 ====================

module.exports = async function handler(req, res) {
    const requestId = `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
        // 驗證請求方法
        if (req.method !== 'GET') {
            return res.status(405).json({
                success: false,
                error: 'Method not allowed',
                code: 'INVALID_METHOD'
            });
        }

        // 驗證環境變數
        if (!config.gistId || !config.githubToken) {
            return res.status(500).json({
                success: false,
                error: '伺服器配置錯誤',
                code: 'MISSING_CONFIG'
            });
        }

        // 獲取查詢參數
        const {
            videoId,
            range = 'all',
            interval,
            stats = 'false',
            limit
        } = req.query;

        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: '缺少影片 ID',
                code: 'MISSING_VIDEO_ID'
            });
        }

        if (!validateVideoId(videoId)) {
            return res.status(400).json({
                success: false,
                error: '無效的影片 ID 格式',
                code: 'INVALID_VIDEO_ID'
            });
        }

        console.log(`[${requestId}] 📡 查詢: videoId=${videoId}, range=${range}`);

        // 獲取影片配置
        const videoConfig = await videosConfig.getVideoConfig();
        const ALL_VIDEO_IDS = videoConfig.ALL_VIDEO_IDS;
        const TRACKED_VIDEOS = videoConfig.TRACKED_VIDEOS;

        // 驗證影片 ID
        if (!ALL_VIDEO_IDS.includes(videoId)) {
            return res.status(400).json({
                success: false,
                error: `未追蹤的影片 ID: ${videoId}`,
                code: 'VIDEO_NOT_TRACKED',
                data: {
                    requestedId: videoId,
                    availableIds: ALL_VIDEO_IDS
                }
            });
        }

        // 讀取 Gist 數據
        const gistData = await fetchGist(config.gistId, config.githubToken);
        const fileName = `youtube-data-${videoId}.json`;

        let allData = [];

        // 讀取影片特定檔案
        if (gistData.files?.[fileName]?.content) {
            allData = safeJsonParse(gistData.files[fileName].content, []);
            console.log(`[${requestId}] 📂 找到 ${fileName}: ${allData.length} 條記錄`);
        }
        // 嘗試舊格式向後兼容
        else if (videoId === 'm2ANkjMRuXc' && gistData.files?.['youtube-data.json']?.content) {
            console.log(`[${requestId}] ⚠️ 使用舊格式檔案`);
            allData = safeJsonParse(gistData.files['youtube-data.json'].content, []);
        }

        // 確保數據排序
        allData.sort((a, b) => a.timestamp - b.timestamp);

        // ==================== 數據處理 ====================
        
        // 1. 時間範圍篩選
        let filteredData = allData;
        if (range && range !== 'all') {
            const hours = parseInt(range);
            if (!isNaN(hours) && hours > 0) {
                const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
                filteredData = allData.filter(item => item.timestamp > cutoffTime);
            }
        }

        // 2. 數據間隔處理
        let processedData = filteredData;
        if (interval === 'hourly' && filteredData.length > 0) {
            const hourlyMap = new Map();
            filteredData.forEach(item => {
                const date = new Date(item.timestamp);
                const hourKey = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}-${date.getHours()}`;
                
                if (!hourlyMap.has(hourKey) || item.timestamp > hourlyMap.get(hourKey).timestamp) {
                    hourlyMap.set(hourKey, item);
                }
            });
            
            processedData = Array.from(hourlyMap.values())
                .sort((a, b) => a.timestamp - b.timestamp);
        } else if (interval === 'daily' && filteredData.length > 0) {
            const dailyMap = new Map();
            filteredData.forEach(item => {
                const date = new Date(item.timestamp);
                const dayKey = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
                
                if (!dailyMap.has(dayKey) || item.timestamp > dailyMap.get(dayKey).timestamp) {
                    dailyMap.set(dayKey, item);
                }
            });
            
            processedData = Array.from(dailyMap.values())
                .sort((a, b) => a.timestamp - b.timestamp);
        }

        // 3. 限制返回條數
        if (limit && !isNaN(parseInt(limit))) {
            const limitNum = parseInt(limit);
            processedData = processedData.slice(-limitNum);
        }

        // 4. 計算統計資訊
        let statistics = null;
        if (stats === 'true' && processedData.length > 0) {
            statistics = calculateStatistics(allData, processedData);
        }

        // ==================== 獲取影片資訊 ====================
        
        let videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);
        
        if (!videoInfo) {
            videoInfo = {
                id: videoId,
                name: videoId,
                color: '#0070f3',
                description: `YouTube 影片: ${videoId}`
            };
        }

        // ==================== 生成響應（統一格式）===================
        
        const processingTime = Date.now() - startTime;
        
        const response = {
            success: true,
            version: '2.0',
            data: processedData,
            videoInfo: {
                id: videoId,
                name: videoInfo.name || videoId,
                color: videoInfo.color || '#0070f3',
                description: videoInfo.description || `YouTube 影片: ${videoId}`
            },
            meta: {
                requestId,
                requestedAt: new Date().toISOString(),
                processingTime: `${processingTime}ms`,
                videoId,
                params: { range, interval, stats, limit },
                originalCount: allData.length,
                returnedCount: processedData.length,
                cacheControl: 'public, max-age=60'
            },
            statistics: statistics
        };

        // 設置緩存 header
        res.setHeader('Cache-Control', 'public, max-age=60');
        
        console.log(`[${requestId}] ✅ 完成，返回 ${processedData.length} 條數據`);
        
        return res.status(200).json(response);

    } catch (error) {
        console.error(`[${requestId}] ❌ 處理失敗:`, error);
        
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