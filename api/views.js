// api/views.js - 獲取影片 view 數的簡單 endpoint
// 用於 OpenClaw 自動化工具檢查 view 是否更新

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  // 只允許 GET 方法
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'method_not_allowed',
      message: '只支援 GET 方法' 
    });
  }

  // 獲取 videoId 參數
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ 
      success: false, 
      error: 'missing_videoId',
      message: '請提供 videoId 參數，例如：/api/views?videoId=m2ANkjMRuXc' 
    });
  }

  // 驗證 videoId 格式
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ 
      success: false, 
      error: 'invalid_videoId',
      message: 'videoId 格式無效，應為 11 位 YouTube 影片 ID',
      videoId 
    });
  }

  // 檢查必要環境變數
  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({ 
      success: false, 
      error: 'missing_api_key',
      message: '伺服器缺少 YouTube API Key' 
    });
  }

  if (!GIST_ID || !GITHUB_TOKEN) {
    return res.status(500).json({ 
      success: false, 
      error: 'missing_gist_config',
      message: '伺服器缺少 Gist 配置' 
    });
  }

  try {
    // 1. 從 YouTube API 獲取即時 view count
    const youtubeUrl = `${YOUTUBE_API_BASE}?id=${videoId}&part=statistics&key=${YOUTUBE_API_KEY}`;
    const youtubeResponse = await fetch(youtubeUrl);

    if (!youtubeResponse.ok) {
      const errorText = await youtubeResponse.text();
      console.error(`YouTube API 錯誤 (${youtubeResponse.status}):`, errorText);
      return res.status(youtubeResponse.status).json({ 
        success: false, 
        error: 'youtube_api_error',
        message: `YouTube API 請求失敗: ${youtubeResponse.status}`,
        videoId 
      });
    }

    const youtubeData = await youtubeResponse.json();

    // 檢查影片是否存在
    if (!youtubeData.items || youtubeData.items.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'video_not_found',
        message: '影片不存在或已被刪除',
        videoId 
      });
    }

    const currentViewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);

    // 2. 從 Gist 讀取上次儲存的 view count
    let lastStoredViewCount = null;
    let lastStoredTimestamp = null;

    const gistResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'vercel-youtube-dashboard',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (gistResponse.ok) {
      const gistData = await gistResponse.json();
      const fileName = `youtube-data-${videoId}.json`;
      
      // 嘗試讀取影片特定檔案
      let content = null;
      
      if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
        content = gistData.files[fileName].content;
      } 
      // 向後兼容：嘗試舊格式
      else if (gistData.files && gistData.files['youtube-data.json']) {
        content = gistData.files['youtube-data.json'].content;
      }

      if (content) {
        try {
          const data = JSON.parse(content);
          
          // 處理不同數據格式
          let snapshots = [];
          
          if (Array.isArray(data)) {
            snapshots = data;
          } else if (data && Array.isArray(data.snapshots)) {
            snapshots = data.snapshots;
          }

          if (snapshots.length > 0) {
            // 找到最新的記錄
            const latestRecord = snapshots[snapshots.length - 1];
            lastStoredViewCount = latestRecord.viewCount || latestRecord.views_total;
            lastStoredTimestamp = latestRecord.timestamp || latestRecord.ts;
            
            // 確保時間戳是數字
            if (typeof lastStoredTimestamp === 'string') {
              lastStoredTimestamp = new Date(lastStoredTimestamp).getTime();
            }
          }
        } catch (parseError) {
          console.warn('解析 Gist 數據失敗:', parseError.message);
        }
      }
    }

    // 3. 計算差異
    const difference = lastStoredViewCount !== null 
      ? currentViewCount - lastStoredViewCount 
      : null;

    const updated = difference !== null && difference > 0;

    // 4. 返回結果
    const response = {
      success: true,
      videoId,
      currentViewCount,
      lastStoredViewCount,
      lastStoredTimestamp: lastStoredTimestamp 
        ? new Date(lastStoredTimestamp).toISOString() 
        : null,
      updated,
      difference,
      timestamp: new Date().toISOString()
    };

    // 設置 Cache-Control（YouTube API 數據cache 1 分鐘）
    res.setHeader('Cache-Control', 'public, max-age=60');

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ [views] 錯誤:', error.message);
    
    return res.status(500).json({ 
      success: false, 
      error: 'internal_error',
      message: '伺服器發生錯誤: ' + error.message,
      videoId 
    });
  }
}

export const config = {
  runtime: 'nodejs',
};
