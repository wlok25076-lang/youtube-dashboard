// test-system.js
const videosConfig = require('./videos-config');

async function testSystem() {
    console.log('🔍 測試系統配置...');
    
    try {
        // 1. 測試配置模組
        console.log('📋 測試配置讀取...');
        const config = await videosConfig.getVideoConfig(true); // 強制刷新
        console.log('✅ 配置讀取成功');
        console.log(`   - 追蹤影片數: ${config.ALL_VIDEO_IDS.length}`);
        console.log(`   - 配置來源: ${config.source}`);
        
        // 2. 列出所有影片
        console.log('\n🎬 追蹤的影片:');
        config.ALL_VIDEO_IDS.forEach((id, index) => {
            const video = Object.values(config.TRACKED_VIDEOS)
                .find(v => v.id === id);
            console.log(`   ${index + 1}. ${video?.name || id} (${id})`);
        });
        
        return true;
    } catch (error) {
        console.error('❌ 測試失敗:', error.message);
        console.error('錯誤詳細信息:', error);
        return false;
    }
}

testSystem();