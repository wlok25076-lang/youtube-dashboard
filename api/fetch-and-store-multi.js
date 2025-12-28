// api/fetch-and-store-multi.js
global.URL = require('url').URL;
global.URLSearchParams = require('url').URLSearchParams;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CRON_AUTH_TOKEN = process.env.CRON_AUTH_TOKEN;

// 【修改】導入影片配置函數
const { 
    getUserVideoConfig, 
    saveUserVideoConfig,
    getVideoById,
    DEFAULT_TRACKED_VIDEOS,
    DEFAULT_ALL_VIDEO_IDS 
} = require('./videos-config');

// 【修改】影片配置 - 改為動態獲取
let TRACKED_VIDEOS = DEFAULT_TRACKED_VIDEOS;
let ALL_VIDEO_IDS = DEFAULT_ALL_VIDEO_IDS;

export default async function handler(req, res) {
      // ==================== 【新增】配置管理端點 ====================
    if (req.query.action === 'manage') {
        return await handleVideoManagement(req, res);
    }

  // ==================== 除錯模式 ====================
  if (req.query.debug === '1') {
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token || req.query.auth;
    
    return res.status(200).json({
      debug: true,
      timestamp: new Date().toISOString(),
      environment: {
        YOUTUBE_API_KEY: YOUTUBE_API_KEY ? `已設定` : '未設定',
        GIST_ID: GIST_ID ? `已設定` : '未設定',
        GITHUB_TOKEN: GITHUB_TOKEN ? `已設定` : '未設定',
        CRON_AUTH_TOKEN: CRON_AUTH_TOKEN ? `已設定 (${CRON_AUTH_TOKEN.length} chars)` : '未設定',
        NODE_ENV: process.env.NODE_ENV,
        TRACKING_VIDEOS: ALL_VIDEO_IDS.length,
        VIDEOS_LIST: ALL_VIDEO_IDS,
        AUTH_RECEIVED: {
          header: authHeader || '(空)',
          query_token: tokenFromQuery || '(空)',
          expected_header: `Bearer ${CRON_AUTH_TOKEN ? '***' + CRON_AUTH_TOKEN.substring(CRON_AUTH_TOKEN.length - 4) : '(無令牌)'}`
        }
      }
    });
  }

  // ==================== 正式邏輯 ====================
  // 1. 檢查請求方法
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 生產環境認證檢查（兼容 cron-job.org）
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.authorization;
    const expectedHeader = `Bearer ${CRON_AUTH_TOKEN}`;
    const tokenFromQuery = req.query.token || req.query.auth;
    
    // 【重要】允許兩種認證方式，兼容 cron-job.org：
    // 1. Authorization: Bearer <token> （標準方式）
    // 2. URL 查詢參數: ?token=<token> 或 ?auth=<token> （cron-job.org 可能用這個）
    const isValidAuth = (
      (authHeader && authHeader === expectedHeader) ||
      (tokenFromQuery && tokenFromQuery === CRON_AUTH_TOKEN)
    );
    
    if (!isValidAuth) {
      console.error('🚨 未授權的定時任務請求', {
        receivedAuthHeader: authHeader || '(空)',
        receivedQueryToken: tokenFromQuery ? '***' + tokenFromQuery.substring(tokenFromQuery.length - 4) : '(空)',
        expectedTokenPreview: CRON_AUTH_TOKEN ? '***' + CRON_AUTH_TOKEN.substring(CRON_AUTH_TOKEN.length - 4) : '(無令牌)',
        clientIP: req.headers['x-forwarded-for'],
        time: new Date().toISOString(),
        url: req.url
      });
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        message: '無效或缺失的授權令牌',
        hint: '請使用: 1. Authorization: Bearer <token> 或 2. URL參數 ?token=<token>',
        received: {
          hasAuthHeader: !!authHeader,
          hasQueryToken: !!tokenFromQuery,
          headerLength: authHeader ? authHeader.length : 0,
          queryTokenLength: tokenFromQuery ? tokenFromQuery.length : 0
        }
      });
    }
  }

  // 3. 檢查必要環境變數
  if (!YOUTUBE_API_KEY || !GIST_ID || !GITHUB_TOKEN) {
    console.error('缺少必要的環境變數:', {
      hasYoutubeKey: !!YOUTUBE_API_KEY,
      hasGistId: !!GIST_ID,
      hasGithubToken: !!GITHUB_TOKEN,
      hasCronToken: !!CRON_AUTH_TOKEN
    });
    return res.status(500).json({ 
      success: false,
      error: '伺服器配置錯誤',
      message: '缺少必要的環境變數',
      details: {
        YOUTUBE_API_KEY: YOUTUBE_API_KEY ? '已設定' : '未設定',
        GIST_ID: GIST_ID ? '已設定' : '未設定',
        GITHUB_TOKEN: GITHUB_TOKEN ? '已設定' : '未設定',
        CRON_AUTH_TOKEN: CRON_AUTH_TOKEN ? '已設定' : '未設定'
      }
    });
  }

  try {
    const results = [];
    
    // 【重要】讀取現有的 Gist 以保留所有檔案
    console.log('📚 讀取現有 Gist 數據...');
    const gistResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Vercel-YouTube-Multi-Tracker'
      }
    });
    
    if (!gistResponse.ok) {
      throw new Error(`無法讀取 Gist: ${gistResponse.status} - ${await gistResponse.text()}`);
    }
    
    const existingGist = await gistResponse.json();
    const filesToUpdate = {};
    
    // 先複製現有檔案（保持其他檔案不變）
    if (existingGist.files) {
      Object.assign(filesToUpdate, existingGist.files);
      console.log(`📁 找到 ${Object.keys(existingGist.files).length} 個現有檔案`);
    }
    
    // 4. 處理所有影片
    console.log(`🚀 開始處理 ${ALL_VIDEO_IDS.length} 個影片...`);
    
    for (const videoId of ALL_VIDEO_IDS) {
      try {
        const videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);
        console.log(`\n📹 處理影片: ${videoInfo?.name || videoId} (${videoId})`);
        
        // 4.1 呼叫 YouTube API
        const youtubeUrl = `${YOUTUBE_API_BASE}?id=${videoId}&part=statistics&key=${YOUTUBE_API_KEY}`;
        console.log(`   🔍 呼叫 YouTube API...`);
        
        const youtubeResponse = await fetch(youtubeUrl);
        
        if (!youtubeResponse.ok) {
          const errorText = await youtubeResponse.text();
          console.error(`   ❌ YouTube API 錯誤 (${videoId}):`, youtubeResponse.status, errorText.substring(0, 200));
          results.push({ 
            videoId, 
            success: false, 
            error: `YouTube API 錯誤: ${youtubeResponse.status}`,
            details: errorText.substring(0, 200)
          });
          continue;
        }
        
        const youtubeData = await youtubeResponse.json();
        
        if (!youtubeData.items || youtubeData.items.length === 0) {
          console.error(`   ❌ 影片未找到: ${videoId}`);
          results.push({ 
            videoId, 
            success: false, 
            error: '影片未找到或無法存取',
            youtubeData: youtubeData
          });
          continue;
        }
        
        const viewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);
        const timestamp = Date.now();
        const currentDate = new Date(timestamp).toISOString().split('T')[0];
        const currentHour = new Date(timestamp).getHours();
        
        console.log(`   ✅ 獲取成功: ${viewCount.toLocaleString()} 次觀看 (${currentDate} ${currentHour}:00)`);
        
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
              // 添加 videoId 和 videoName 字段
              currentData = oldData.map(item => ({
                timestamp: item.timestamp,
                viewCount: item.viewCount,
                date: item.date || new Date(item.timestamp).toISOString().split('T')[0],
                hour: item.hour || new Date(item.timestamp).getHours(),
                videoId: videoId,
                videoName: videoInfo?.name || videoId
              }));
              console.log(`   ✅ 遷移 ${currentData.length} 條舊數據到 ${fileName}`);
            }
          } catch (e) {
            console.error('   遷移失敗:', e.message);
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
        console.log(`   📝 添加新記錄: ${currentDate} ${currentHour}:00 - ${viewCount.toLocaleString()} 次觀看`);
        
        // 4.5 清理舊數據（保留最近30天）
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const freshData = currentData.filter(item => item.timestamp > thirtyDaysAgo);
        if (freshData.length < currentData.length) {
          console.log(`   🧹 清理了 ${currentData.length - freshData.length} 條過期記錄（30天前）`);
          currentData = freshData;
        }
        
        // 確保按時間排序
        currentData.sort((a, b) => a.timestamp - b.timestamp);
        
        // 4.6 準備更新Gist檔案
        filesToUpdate[fileName] = {
          content: JSON.stringify(currentData, null, 2)
        };
        
        results.push({
          videoId,
          success: true,
          viewCount,
          viewCountFormatted: viewCount.toLocaleString(),
          totalEntries: currentData.length,
          videoName: videoInfo?.name || videoId,
          timestamp: new Date(timestamp).toISOString()
        });
        
        console.log(`   ✅ ${videoInfo?.name || videoId}: 總計 ${currentData.length} 條記錄`);
        
      } catch (error) {
        console.error(`   ❌ 處理影片 ${videoId} 失敗:`, error.message);
        results.push({
          videoId,
          success: false,
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
      
      // 避免太快觸發YouTube API限制
      await new Promise(resolve => setTimeout(resolve, 800));
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
      const errorText = await updateResponse.text();
      throw new Error(`Gist 更新失敗: ${updateResponse.status} - ${errorText.substring(0, 200)}`);
    }
    
    console.log(`✅ Gist 更新成功`);
    
    // 6. 成功回應
    const successful = results.filter(r => r.success).length;
    const totalViews = results.filter(r => r.success).reduce((sum, r) => sum + r.viewCount, 0);
    
    res.status(200).json({ 
      success: true,
      message: `已處理 ${successful}/${ALL_VIDEO_IDS.length} 個影片`,
      summary: {
        totalVideos: ALL_VIDEO_IDS.length,
        successful: successful,
        failed: ALL_VIDEO_IDS.length - successful,
        totalViews: totalViews,
        totalViewsFormatted: totalViews.toLocaleString()
      },
      results,
      timestamp: new Date().toISOString(),
      nextSuggestion: successful > 0 ? '🎉 數據更新完成！' : '⚠️ 部分影片更新失敗，請檢查日誌'
    });
    
  } catch (error) {
    console.error('❌ 多影片更新失敗:', error);
    res.status(500).json({ 
      success: false,
      error: '內部伺服器錯誤',
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// ==================== 【新增】影片管理API處理函數 ====================
async function handleVideoManagement(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed. Use POST for management actions.' 
        });
    }

    const { action } = req.query;
    let body;

    try {
        body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        }
    } catch (e) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid JSON body' 
        });
    }

    try {
        switch (action) {
            case 'get': {
                // 獲取當前配置
                const config = await getUserVideoConfig();
                return res.status(200).json({
                    success: true,
                    videos: Object.values(config.TRACKED_VIDEOS),
                    total: config.ALL_VIDEO_IDS.length
                });
            }
                
            case 'add': {
                // 添加新影片
                const { id, name, description, color } = body;
                
                if (!id || !name) {
                    return res.status(400).json({
                        success: false,
                        error: '影片ID和名稱是必需的'
                    });
                }
                
                // 驗證YouTube影片ID格式
                if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
                    return res.status(400).json({
                        success: false,
                        error: '無效的YouTube影片ID格式。應為11位字符'
                    });
                }
                
                // 獲取當前配置
                const config = await getUserVideoConfig();
                const videoList = Object.values(config.TRACKED_VIDEOS);
                
                // 檢查重複
                if (videoList.some(v => v.id === id)) {
                    return res.status(400).json({
                        success: false,
                        error: '影片ID已存在'
                    });
                }
                
                // 添加新影片
                const newVideo = {
                    id,
                    name,
                    description: description || `${name} - YouTube影片播放量追蹤`,
                    color: color || '#0070f3',
                    startDate: new Date().toISOString().split('T')[0]
                };
                
                videoList.push(newVideo);
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '儲存配置失敗'
                    });
                }
                
                return res.status(200).json({
                    success: true,
                    message: '影片添加成功',
                    video: newVideo,
                    total: videoList.length
                });
            }
                
            case 'delete': {
                // 刪除影片
                const { id } = body;
                
                if (!id) {
                    return res.status(400).json({
                        success: false,
                        error: '影片ID是必需的'
                    });
                }
                
                // 獲取當前配置
                const config = await getUserVideoConfig();
                let videoList = Object.values(config.TRACKED_VIDEOS);
                
                // 檢查是否可以刪除（至少保留一個影片）
                if (videoList.length <= 1) {
                    return res.status(400).json({
                        success: false,
                        error: '至少需要保留一個追蹤影片'
                    });
                }
                
                // 查找影片
                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到'
                    });
                }
                
                const deletedVideo = videoList[index];
                videoList.splice(index, 1);
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '刪除配置失敗'
                    });
                }
                
                return res.status(200).json({
                    success: true,
                    message: '影片刪除成功',
                    deletedVideo,
                    total: videoList.length
                });
            }
                
            case 'update': {
                // 更新影片
                const { id, name, description, color } = body;
                
                if (!id) {
                    return res.status(400).json({
                        success: false,
                        error: '影片ID是必需的'
                    });
                }
                
                // 獲取當前配置
                const config = await getUserVideoConfig();
                let videoList = Object.values(config.TRACKED_VIDEOS);
                
                // 找到並更新影片
                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到'
                    });
                }
                
                if (name) videoList[index].name = name;
                if (description !== undefined) videoList[index].description = description;
                if (color) videoList[index].color = color;
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    return res.status(500).json({
                        success: false,
                        error: '更新配置失敗'
                    });
                }
                
                return res.status(200).json({
                    success: true,
                    message: '影片更新成功',
                    video: videoList[index],
                    total: videoList.length
                });
            }
                
            default:
                return res.status(400).json({
                    success: false,
                    error: '未知的操作類型'
                });
        }
    } catch (error) {
        console.error('影片管理操作失敗:', error);
        return res.status(500).json({
            success: false,
            error: '內部伺服器錯誤',
            message: error.message
        });
    }
}

export const config = {
  runtime: 'nodejs',
};