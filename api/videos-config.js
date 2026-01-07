// api/videos-config.js - 【修改為動態讀取】
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// 預設的追蹤影片
const DEFAULT_TRACKED_VIDEOS = {
    'main': {
        id: 'm2ANkjMRuXc',
        name: '純粹とは何か?',
        description: '主要追蹤的YouTube影片',
        color: '#0070f3',
        startDate: '2024-01-01'
    },
    'biryani': {
        id: 'NReeTQ3YTAU',
        name: 'ビリヤニ',
        description: 'ビリヤニに関するYouTube影片',
        color: '#10b981',
        startDate: '2024-01-01'
    },
    'snowghost': {
        id: 'bobUT-j6PeQ',
        name: 'スノウゴースト',
        description: 'スノウゴーストに関するYouTube影片',
        color: '#f59e0b',
        startDate: '2024-01-01'
    }
};

// 獲取所有影片ID
const DEFAULT_ALL_VIDEO_IDS = Object.values(DEFAULT_TRACKED_VIDEOS).map(v => v.id);

// 【新增】從Gist讀取使用者配置的影片列表
async function getUserVideoConfig() {
    if (!GIST_ID || !GITHUB_TOKEN) {
        console.log('⚠️ 沒有GIST設定，使用預設配置');
        return {
            TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
            ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS
        };
    }

    try {
        // 讀取Gist中的影片配置
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'vercel-app'
            }
        });

        if (!response.ok) {
            console.log(`⚠️ 無法讀取Gist: ${response.status}，使用預設配置`);
            return {
                TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
                ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS
            };
        }

        const gistData = await response.json();
        const configFileName = 'youtube-videos-config.json';
        
        // 檢查是否有使用者配置檔案
        if (gistData.files && gistData.files[configFileName] && gistData.files[configFileName].content) {
            try {
                const userConfig = JSON.parse(gistData.files[configFileName].content);
                
                // 驗證配置格式
                if (Array.isArray(userConfig) && userConfig.length > 0) {
                    // 轉換為與前端一致的格式
                    const trackedVideos = {};
                    userConfig.forEach((video, index) => {
                        const key = `video_${index}`;
                        trackedVideos[key] = {
                            id: video.id,
                            name: video.name,
                            description: video.description || `${video.name} - YouTube影片播放量追蹤`,
                            color: video.color || '#0070f3',
                            startDate: video.startDate || new Date().toISOString().split('T')[0]
                        };
                    });
                    
                    const allVideoIds = userConfig.map(v => v.id);
                    
                    console.log(`✅ 成功載入使用者配置: ${allVideoIds.length} 個影片`);
                    return {
                        TRACKED_VIDEOS: trackedVideos,
                        ALL_VIDEO_IDS: allVideoIds
                    };
                }
            } catch (parseError) {
                console.error('❌ 解析使用者配置失敗:', parseError.message);
            }
        }
        
        // 沒有找到有效的使用者配置，使用預設
        console.log('📭 沒有找到使用者配置，使用預設配置');
        return {
            TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
            ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS
        };
        
    } catch (error) {
        console.error('❌ 讀取使用者配置時發生錯誤:', error.message);
        return {
            TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
            ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS
        };
    }
}

// 【新增】寫入使用者配置到Gist
async function saveUserVideoConfig(videos) {
    if (!GIST_ID || !GITHUB_TOKEN) {
        console.error('❌ 無法儲存配置: 缺少GIST設定');
        return false;
    }

    try {
        // 先讀取現有Gist
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'vercel-app'
            }
        });

        if (!response.ok) {
            console.error(`❌ 無法讀取Gist: ${response.status}`);
            return false;
        }

        const gistData = await response.json();
        const filesToUpdate = { ...gistData.files };
        
        // 準備影片配置
        const configFileName = 'youtube-videos-config.json';
        const videosArray = videos.map(video => ({
            id: video.id,
            name: video.name,
            description: video.description,
            color: video.color,
            startDate: video.startDate || new Date().toISOString().split('T')[0]
        }));
        
        // 更新或新增配置檔案
        filesToUpdate[configFileName] = {
            content: JSON.stringify(videosArray, null, 2)
        };
        
        // 更新Gist
        const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'vercel-app'
            },
            body: JSON.stringify({
                description: `YouTube追蹤影片配置，最後更新: ${new Date().toISOString()}`,
                files: filesToUpdate
            })
        });

        if (!updateResponse.ok) {
            console.error(`❌ 更新Gist失敗: ${updateResponse.status}`);
            return false;
        }
        
        console.log(`✅ 成功儲存影片配置: ${videos.length} 個影片`);
        return true;
        
    } catch (error) {
        console.error('❌ 儲存配置時發生錯誤:', error);
        return false;
    }
}

// 立即獲取配置（同步方式，但會警告）
let currentConfig = {
    TRACKED_VIDEOS: DEFAULT_TRACKED_VIDEOS,
    ALL_VIDEO_IDS: DEFAULT_ALL_VIDEO_IDS
};

// 異步初始化
(async () => {
    try {
        const config = await getUserVideoConfig();
        currentConfig = config;
        console.log('✅ 影片配置初始化完成');
    } catch (error) {
        console.error('❌ 影片配置初始化失敗:', error.message);
    }
})();

module.exports = {
    // 導出當前配置
    get TRACKED_VIDEOS() { return currentConfig.TRACKED_VIDEOS; },
    get ALL_VIDEO_IDS() { return currentConfig.ALL_VIDEO_IDS; },
    
    // 導出函數
    getUserVideoConfig,
    saveUserVideoConfig,
    
    // 輔助函數
    getVideoById: (id) => {
        return Object.values(currentConfig.TRACKED_VIDEOS).find(v => v.id === id);
    },
    
    // 預設值（供其他檔案使用）
    DEFAULT_TRACKED_VIDEOS,
    DEFAULT_ALL_VIDEO_IDS
};