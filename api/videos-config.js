/**
 * 影片配置管理模組
 * 
 * 功能：
 * - 從 GitHub Gist 讀取/寫入影片配置
 * - 支援使用者自定義影片列表
 * - 向後兼容預設配置
 */

const config = {
    gistId: process.env.GIST_ID?.trim() || null,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null
};

// ==================== 預設影片配置 ====================

const DEFAULT_TRACKED_VIDEOS = {
    'main': {
        id: 'm2ANkjMRuXc',
        name: '純粹とは何か?',
        description: '主要追蹤的 YouTube 影片',
        color: '#0070f3',
        startDate: '2024-01-01'
    },
    'biryani': {
        id: 'NReeTQ3YTAU',
        name: 'ビリヤニ',
        description: 'ビリヤニ に関する YouTube 影片',
        color: '#10b981',
        startDate: '2024-01-01'
    },
    'snowghost': {
        id: 'bobUT-j6PeQ',
        name: 'スノウゴースト',
        description: 'スノウゴースト に関する YouTube 影片',
        color: '#f59e0b',
        startDate: '2024-01-01'
    }
};

const DEFAULT_ALL_VIDEO_IDS = Object.values(DEFAULT_TRACKED_VIDEOS).map(v => v.id);

// 配置檔案名稱
const CONFIG_FILE_NAME = 'youtube-videos-config.json';

// ==================== 工具函式 ====================

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
        } catch (error) {
            console.error('JSON 解析失敗:', error.message);
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * HTTP 請求封裝
 */
async function fetchGist(gistId, githubToken) {
    if (!gistId || !githubToken) {
        throw new Error('缺少 Gist 設定');
    }

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
 * 更新 Gist
 */
async function updateGist(gistId, githubToken, files, description) {
    if (!gistId || !githubToken) {
        throw new Error('缺少 Gist 設定');
    }

    const url = `https://api.github.com/gists/${gistId}`;
    const response = await fetch(url, {
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
        throw new Error(`更新 Gist 失敗: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    return response.json();
}

/**
 * 驗證影片配置格式
 */
function validateVideoConfig(config) {
    if (!Array.isArray(config)) {
        return { valid: false, error: '配置必須是陣列格式' };
    }

    for (let i = 0; i < config.length; i++) {
        const video = config[i];
        
        if (!video.id || typeof video.id !== 'string') {
            return { valid: false, error: `第 ${i + 1} 個影片缺少 id 欄位` };
        }
        
        if (!/^[a-zA-Z0-9_-]{11}$/.test(video.id)) {
            return { valid: false, error: `第 ${i + 1} 個影片 id 格式無效: ${video.id}` };
        }
        
        if (!video.name || typeof video.name !== 'string') {
            return { valid: false, error: `第 ${i + 1} 個影片缺少 name 欄位` };
        }
        
        if (video.name.length > 100) {
            return { valid: false, error: `第 ${i + 1} 個影片名稱過長` };
        }
    }

    return { valid: true };
}

/**
 * 去除字串前後空白
 */
function trimString(str) {
    return typeof str === 'string' ? str.trim() : str;
}

// ==================== 配置管理 ====================

/**
 * 快取配置
 */
let configCache = {
    data: null,
    timestamp: 0,
    ttl: 60000 // 1 分鐘快取
};

/**
 * 從 Gist 讀取使用者配置
 */
async function loadUserConfig() {
    try {
        const gistData = await fetchGist(config.gistId, config.githubToken);
        
        if (!gistData.files || !gistData.files[CONFIG_FILE_NAME]) {
            console.log('沒有找到使用者配置，使用預設配置');
            return null;
        }

        const content = gistData.files[CONFIG_FILE_NAME].content;
        const userConfig = safeJsonParse(content);

        if (!userConfig) {
            console.warn('解析使用者配置失敗');
            return null;
        }

        // 驗證配置格式
        const validation = validateVideoConfig(userConfig);
        if (!validation.valid) {
            console.warn(`使用者配置驗證失敗: ${validation.error}`);
            return null;
        }

        console.log(`成功載入使用者配置: ${userConfig.length} 個影片`);
        return userConfig;

    } catch (error) {
        console.error('讀取使用者配置失敗:', error.message);
        return null;
    }
}

/**
 * 獲取影片配置（主要匯出函式）
 * 
 * @param {boolean} forceRefresh - 強制刷新快取
 * @returns {Promise<Object>} 影片配置物件
 */
async function getVideoConfig(forceRefresh) {
    forceRefresh = forceRefresh === true;
    
    const now = Date.now();
    const cacheExpired = !configCache.data || (now - configCache.timestamp > configCache.ttl);

    // 檢查快取
    if (!forceRefresh && !cacheExpired) {
        console.log('使用快取的配置');
        return configCache.data;
    }

    try {
        // 嘗試載入使用者配置
        const userConfig = await loadUserConfig();

        if (userConfig && userConfig.length > 0) {
            // 轉換為內部格式
            const trackedVideos = {};
            userConfig.forEach((video, index) => {
                trackedVideos[`video_${index}`] = {
                    id: video.id,
                    name: trimString(video.name),
                    description: trimString(video.description) || `${video.name} - YouTube 影片播放量追蹤`,
                    color: trimString(video.color) || '#0070f3',
                    startDate: video.startDate || new Date().toISOString().split('T')[0]
                };
            });

            const allVideoIds = userConfig.map(v => v.id);

            const result = {
                TRACKED_VIDEOS: trackedVideos,
                ALL_VIDEO_IDS: allVideoIds,
                source: 'user'
            };

            // 更新快取
            configCache = {
                data: result,
                timestamp: now
            };

            return result;
        }

        // 使用預設配置
        const result = {
            TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
            ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS,
            source: 'default'
        };

        // 更新快取
        configCache = {
            data: result,
            timestamp: now
        };

        return result;

    } catch (error) {
        console.error('獲取配置失敗，使用預設值:', error.message);
        
        // 失敗時返回預設配置
        return {
            TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
            ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS,
            source: 'fallback'
        };
    }
}

/**
 * 儲存影片配置到 Gist
 * 
 * @param {Array} videos - 影片物件陣列
 * @returns {Promise<boolean>} 是否成功
 */
async function saveVideoConfig(videos) {
    if (!config.gistId || !config.githubToken) {
        console.error('無法儲存配置: 缺少 Gist 設定');
        return false;
    }

    try {
        // 驗證配置
        const validation = validateVideoConfig(videos);
        if (!validation.valid) {
            console.error(`配置驗證失敗: ${validation.error}`);
            return false;
        }

        // 讀取現有 Gist
        const gistData = await fetchGist(config.gistId, config.githubToken);
        const filesToUpdate = { ...gistData.files };

        // 準備配置資料
        const videosArray = videos.map(video => ({
            id: trimString(video.id),
            name: trimString(video.name),
            description: trimString(video.description),
            color: trimString(video.color) || '#0070f3',
            startDate: video.startDate || new Date().toISOString().split('T')[0]
        }));

        // 更新或新增配置檔案
        filesToUpdate[CONFIG_FILE_NAME] = {
            content: JSON.stringify(videosArray, null, 2)
        };

        // 更新 Gist
        await updateGist(
            config.gistId,
            config.githubToken,
            filesToUpdate,
            `YouTube 追蹤影片配置 (${videos.length} 個影片)，更新: ${new Date().toISOString()}`
        );

        // 清除快取
        configCache = {
            data: null,
            timestamp: 0
        };

        console.log(`成功儲存影片配置: ${videos.length} 個影片`);
        return true;

    } catch (error) {
        console.error('儲存配置失敗:', error.message);
        return false;
    }
}

/**
 * 根據影片 ID 獲取影片資訊
 */
function getVideoById(id) {
    return Object.values(configCache.data?.TRACKED_VIDEOS || DEFAULT_TRACKED_VIDEOS)
        .find(v => v.id === id);
}

/**
 * 清除配置快取
 */
function clearConfigCache() {
    configCache = {
        data: null,
        timestamp: 0
    };
    console.log('配置快取已清除');
}

// ==================== 匯出 ====================

module.exports = {
    // 影片配置獲取
    getVideoConfig,
    
    // 影片配置儲存
    saveVideoConfig,
    
    // 輔助函式
    getVideoById,
    clearConfigCache,
    
    // 預設配置
    DEFAULT_TRACKED_VIDEOS,
    DEFAULT_ALL_VIDEO_IDS
};
