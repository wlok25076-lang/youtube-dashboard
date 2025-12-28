// api/test-config.js
const videosConfig = require('./videos-config');

module.exports = async function handler(req, res) {
    try {
        console.log('🔍 開始測試系統配置...');
        
        // 強制刷新配置
        const config = await videosConfig.getVideoConfig(true);
        
        console.log('✅ 配置讀取成功');
        console.log(`追蹤影片數: ${config.ALL_VIDEO_IDS.length}`);
        
        const response = {
            success: true,
            system: {
                status: 'operational',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development'
            },
            config: {
                totalVideos: config.ALL_VIDEO_IDS.length,
                source: config.source,
                videos: config.ALL_VIDEO_IDS.map(id => {
                    const video = Object.values(config.TRACKED_VIDEOS).find(v => v.id === id);
                    return {
                        id,
                        name: video?.name || 'Unknown',
                        color: video?.color || '#0070f3',
                        description: video?.description || ''
                    };
                })
            },
            environment: {
                hasGistId: !!process.env.GIST_ID,
                hasGithubToken: !!process.env.GITHUB_TOKEN,
                hasYoutubeApiKey: !!process.env.YOUTUBE_API_KEY,
                gistIdLength: process.env.GIST_ID?.length || 0
            }
        };
        
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).json(response);
        
    } catch (error) {
        console.error('❌ 測試失敗:', error);
        
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
};