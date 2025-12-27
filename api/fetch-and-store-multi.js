// api/fetch-and-store-multi.js
global.URL = require('url').URL;
global.URLSearchParams = require('url').URLSearchParams;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CRON_AUTH_TOKEN = process.env.CRON_AUTH_TOKEN;

// 【新增】導入影片配置
let TRACKED_VIDEOS = {};
let ALL_VIDEO_IDS = ['m2ANkjMRuXc']; // 默認值

try {
    const config = require('./videos-config');
    TRACKED_VIDEOS = config.TRACKED_VIDEOS;
    ALL_VIDEO_IDS = config.ALL_VIDEO_IDS;
    console.log('✅ 載入影片配置成功，追蹤影片數:', ALL_VIDEO_IDS.length);
} catch (error) {
    console.warn('⚠️ 無法載入 videos-config.js，使用默認配置:', error.message);
}

export default async function handler(req, res) {
  // ==================== 除錯模式 ====================
  if (req.query.debug === '1') {
    const authHeader = req.headers.authorization;
    return res.status(200).json({
      debug: true,
      timestamp: new Date().toISOString(),
      environment: {
        YOUTUBE_API_KEY: YOUTUBE_API_KEY ? `已設定` : '未設定',
        GIST_ID: GIST_ID ? `已設定` : '未設定',
        GITHUB_TOKEN: GITHUB_TOKEN ? `已設定` : '未設定',
        CRON_AUTH_TOKEN: CRON_AUTH_TOKEN ? `已設定` : '未設定',
        NODE_ENV: process.env.NODE_ENV,
        TRACKING_VIDEOS: ALL_VIDEO_IDS.length,
        VIDEOS_LIST: ALL_VIDEO_IDS
      }
    });
  }

  // ==================== 正式邏輯 ====================
  // 1. 檢查請求方法
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 生產環境認證檢查
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.authorization;
    const expectedHeader = `Bearer ${CRON_AUTH_TOKEN}`;
    
    if (!authHeader || authHeader !== expectedHeader) {
      console.error('🚨 未授權的定時任務請求', {
        received: authHeader || '(空)',
        expectedPreview: expectedHeader.substring(0, 20) + '...',
        time: new Date().toISOString()
      });
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: '無效或缺失的授權令牌'
      });
    }
  }

  // 3. 檢查必要環境變數
  if (!YOUTUBE_API_KEY || !GIST_ID || !GITHUB_TOKEN) {
    console.error('缺少必要的環境變數:', {
      hasYoutubeKey: !!YOUTUBE_API_KEY,
      hasGistId: !!GIST_ID,
      hasGithubToken: !!GITHUB_TOKEN
    });
    return res.status(500).json({ 
      error: '伺服器配置錯誤',
      message: '缺少 API 金鑰、Gist ID 或 GitHub Token'
    });
  }

  try {
    const results = [];
    
    // 【重要】讀取現有的 Gist 以保留所有檔案
    const gistResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Vercel-YouTube-Multi-Tracker'
      }
    });
    
    if (!gistResponse.ok) {
      throw new Error(`無法讀取 Gist: ${gistResponse.status}`);
    }
    
    const existingGist = await gistResponse.json();
    const filesToUpdate = {};
    
    // 先複製現有檔案（保持其他檔案不變）
    if (existingGist.files) {
      Object.assign(filesToUpdate, existingGist.files);
    }
    
    // 4. 處理所有影片
    console.log(`🚀 開始處理 ${ALL_VIDEO_IDS.length} 個影片...`);
    
    for (const videoId of ALL_VIDEO_IDS) {
      try {
        const videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);
        console.log(`\n📹 處理影片: ${videoInfo?.name || videoId} (${videoId})`);
        
        // 4.1 呼叫 YouTube API
        const youtubeUrl = `${YOUTUBE_API_BASE}?id=${videoId}&part=statistics&key=${YOUTUBE_API_KEY}`;
        console.log(`   🔍 呼叫 YouTube API: ${videoId}`);
        
        const youtubeResponse = await fetch(youtubeUrl);
        
        if (!youtubeResponse.ok) {
          console.error(`   ❌ YouTube API 錯誤 (${videoId}):`, youtubeResponse.status);
          results.push({ videoId, success: false, error: `YouTube API 錯誤: ${youtubeResponse.status}` });
          continue;
        }
        
        const youtubeData = await youtubeResponse.json();
        
        if (!youtubeData.items || youtubeData.items.length === 0) {
          console.error(`   ❌ 影片未找到: ${videoId}`);
          results.push({ videoId, success: false, error: '影片未找到' });
          continue;
        }
        
        const viewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);
        const timestamp = Date.now();
        const currentDate = new Date(timestamp).toISOString().split('T')[0];
        const currentHour = new Date(timestamp).getHours();
        
        console.log(`   ✅ 獲取成功: ${viewCount} 次觀看 (${currentDate} ${currentHour}:00)`);
        
        // 4.2 讀取該影片的現有數據
        const fileName = `youtube-data-${videoId}.json`;
        let currentData = [];
        
        if (existingGist.files && existingGist.files[fileName] && existingGist.files[fileName].content) {
          try {
            currentData = JSON.parse(existingGist.files[fileName].content);
            if (!Array.isArray(currentData)) {
              console.warn(`   ⚠️ Gist 內容不是陣列，重置為空陣列`);
              currentData = [];
            } else {
              console.log(`   📂 讀取現有數據: ${currentData.length} 條記錄`);
            }
          } catch (parseError) {
            console.warn(`   ⚠️ 解析 ${fileName} 失敗:`, parseError.message);
            currentData = [];
          }
        } else {
          console.log(`   📭 沒有找到現有數據，創建新檔案`);
        }
        
        // 4.3 【特別處理】如果是主影片且沒有新格式檔案，嘗試從舊格式遷移
        if (videoId === 'm2ANkjMRuXc' && currentData.length === 0 && 
            existingGist.files && existingGist.files['youtube-data.json']) {
          console.log(`   🔄 遷移舊數據到新格式: ${videoId}`);
          try {
            const oldData = JSON.parse(existingGist.files['youtube-data.json'].content);
            if (Array.isArray(oldData)) {
              currentData = oldData.map(item => ({
                ...item,
                videoId: videoId, // 添加videoId字段
                videoName: videoInfo?.name || videoId
              }));
              console.log(`   ✅ 遷移 ${currentData.length} 條舊數據到 ${fileName}`);
            }
          } catch (e) {
            console.error('   遷移失敗:', e);
          }
        }
        
        // 4.4 添加新記錄
        const newEntry = { 
          timestamp, 
          viewCount, 
          date: currentDate,
          hour: currentHour,
          videoId,
          videoName: videoInfo?.name || videoId
        };
        
        currentData.push(newEntry);
        console.log(`   📝 添加新記錄: ${currentDate} ${currentHour}:00 - ${viewCount} 次觀看`);
        
        // 4.5 清理舊數據（保留最近30天）
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const freshData = currentData.filter(item => item.timestamp > thirtyDaysAgo);
        if (freshData.length < currentData.length) {
          console.log(`   🧹 清理了 ${currentData.length - freshData.length} 條過期記錄`);
          currentData = freshData;
        }
        
        currentData.sort((a, b) => a.timestamp - b.timestamp);
        
        // 4.6 準備更新Gist檔案
        filesToUpdate[fileName] = {
          content: JSON.stringify(currentData, null, 2)
        };
        
        results.push({
          videoId,
          success: true,
          viewCount,
          totalEntries: currentData.length,
          videoName: videoInfo?.name || videoId
        });
        
        console.log(`   ✅ ${videoInfo?.name || videoId}: 總計 ${currentData.length} 條記錄`);
        
      } catch (error) {
        console.error(`   ❌ 處理影片 ${videoId} 失敗:`, error);
        results.push({
          videoId,
          success: false,
          error: error.message
        });
      }
      
      // 避免太快觸發YouTube API限制
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 5. 批量更新所有檔案到Gist
    console.log(`\n📤 更新 Gist (${Object.keys(filesToUpdate).length} 個檔案)...`);
    const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-YouTube-Multi-Tracker'
      },
      body: JSON.stringify({
        description: `YouTube 多影片追蹤數據 (${ALL_VIDEO_IDS.length} 個影片)，最後更新: ${new Date().toISOString()}`,
        files: filesToUpdate
      })
    });
    
    if (!updateResponse.ok) {
      throw new Error(`Gist 更新失敗: ${updateResponse.status}`);
    }
    
    console.log(`✅ Gist 更新成功`);
    
    // 6. 成功回應
    const successful = results.filter(r => r.success).length;
    res.status(200).json({ 
      success: true,
      message: `已處理 ${successful}/${ALL_VIDEO_IDS.length} 個影片`,
      results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 多影片更新失敗:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}

export const config = {
  runtime: 'nodejs',
};