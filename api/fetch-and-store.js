// api/fetch-and-store.js
global.URL = require('url').URL;
global.URLSearchParams = require('url').URLSearchParams;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CRON_AUTH_TOKEN = process.env.CRON_AUTH_TOKEN; // 明確聲明

export default async function handler(req, res) {
  // ==================== 除錯模式 ====================
  // 訪問 /api/fetch-and-store?debug=1 來查看詳細資訊
  if (req.query.debug === '1') {
    const authHeader = req.headers.authorization;
    return res.status(200).json({
      debug: true,
      timestamp: new Date().toISOString(),
      headersReceived: {
        authorization: authHeader || '(未收到)',
        // 可選：查看其他你可能關心的頭
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
      },
      environment: {
        YOUTUBE_API_KEY: YOUTUBE_API_KEY ? `已設定 (前4位: ${YOUTUBE_API_KEY.substring(0,4)}...)` : '未設定',
        GIST_ID: GIST_ID ? `已設定` : '未設定',
        GITHUB_TOKEN: GITHUB_TOKEN ? `已設定` : '未設定',
        CRON_AUTH_TOKEN: CRON_AUTH_TOKEN ? `已設定 (前4位: ${CRON_AUTH_TOKEN.substring(0,4)}...)` : '未設定',
        NODE_ENV: process.env.NODE_ENV,
        VERCEL_ENV: process.env.VERCEL_ENV || '未設定',
      },
      // 核心診斷資訊
      authDiagnosis: {
        receivedHeader: authHeader,
        expectedPrefix: `Bearer ${CRON_AUTH_TOKEN ? CRON_AUTH_TOKEN.substring(0, 4) + '...' : '[無令牌]'}`,
        matchStatus: authHeader === `Bearer ${CRON_AUTH_TOKEN}` ? '匹配' : '不匹配',
        isProduction: process.env.NODE_ENV === 'production',
        willBlockInProd: (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${CRON_AUTH_TOKEN}`) ? '是' : '否',
      }
    });
  }

  // ==================== 正式邏輯 ====================
  // 1. 檢查請求方法
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 生產環境認證檢查 (使用標準 Authorization: Bearer 頭)
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.authorization;
    const expectedHeader = `Bearer ${CRON_AUTH_TOKEN}`;
    
    if (!authHeader || authHeader !== expectedHeader) {
      // 記錄詳細的失敗日誌以便排查
      console.error('🚨 未授權的定時任務請求', {
        received: authHeader || '(空)',
        expectedPreview: expectedHeader.substring(0, 20) + '...',
        clientIP: req.headers['x-forwarded-for'],
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

  const VIDEO_ID = 'm2ANkjMRuXc'; // 你要追蹤的固定影片 ID

  try {
    // 4. 呼叫 YouTube API
    const youtubeUrl = `${YOUTUBE_API_BASE}?id=${VIDEO_ID}&part=statistics&key=${YOUTUBE_API_KEY}`;
    const youtubeResponse = await fetch(youtubeUrl);

    if (!youtubeResponse.ok) {
      const errorText = await youtubeResponse.text();
      console.error(`YouTube API 錯誤 (${youtubeResponse.status}):`, errorText);
      return res.status(youtubeResponse.status).json({ 
        error: `YouTube API 錯誤`,
        details: errorText.substring(0, 200) // 限制長度
      });
    }

    const youtubeData = await youtubeResponse.json();

    if (!youtubeData.items || youtubeData.items.length === 0) {
      console.error(`影片未找到: ${VIDEO_ID}`);
      return res.status(404).json({ error: '影片未找到' });
    }

    const viewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);
    const timestamp = Date.now();
    const currentDate = new Date(timestamp).toISOString().split('T')[0];
    const currentHour = new Date(timestamp).getHours(); // 獲取當前小時

    // 5. 讀取現有 Gist 數據
    const gistResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Vercel-YouTube-Tracker',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!gistResponse.ok) {
      console.error(`GitHub Gist 讀取錯誤 (${gistResponse.status}):`, await gistResponse.text());
      return res.status(gistResponse.status).json({ 
        error: '讀取 Gist 數據失敗'
      });
    }

    const gistData = await gistResponse.json();
    const fileName = 'youtube-data.json';
    let currentData = [];

    if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        currentData = JSON.parse(gistData.files[fileName].content);
        // 確保是陣列
        if (!Array.isArray(currentData)) {
          console.warn('Gist 內容不是陣列，重置為空陣列');
          currentData = [];
        }
      } catch (parseError) {
        console.warn('解析現有 Gist JSON 失敗，重置:', parseError.message);
        currentData = [];
      }
    }

    // ========== 【核心修改部分】==========
    // 6. 新增數據（始終添加新記錄，不做重複檢查）
    const newEntry = { 
      timestamp, 
      viewCount, 
      date: currentDate,
      hour: currentHour, // 添加小時字段，便於分析
      videoId: VIDEO_ID
    };

    // 直接添加新記錄
    currentData.push(newEntry);
    console.log(`✅ 新增記錄: ${currentDate} ${currentHour}:00 - ${viewCount} 次觀看 (總計: ${currentData.length} 條記錄)`);

    // 【可選】自動清理舊數據（保留最近7天，防止數據無限增長）
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7天前的時間戳
    const freshData = currentData.filter(item => item.timestamp > sevenDaysAgo);
    if (freshData.length < currentData.length) {
      console.log(`🧹 清理了 ${currentData.length - freshData.length} 條過期記錄（7天前）`);
      currentData = freshData;
    }
    // ========== 【修改結束】==========

    // 按時間戳記排序（確保數據按時間順序）
    currentData.sort((a, b) => a.timestamp - b.timestamp);

    // 7. 更新 Gist
    const updatedContent = JSON.stringify(currentData, null, 2);
    const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-YouTube-Tracker'
      },
      body: JSON.stringify({
        description: `YouTube 影片 ${VIDEO_ID} 觀看數追蹤數據，最後更新: ${new Date().toISOString()}`,
        files: {
          [fileName]: {
            content: updatedContent
          }
        }
      })
    });

    if (!updateResponse.ok) {
      console.error(`GitHub Gist 更新錯誤 (${updateResponse.status}):`, await updateResponse.text());
      return res.status(updateResponse.status).json({ 
        error: '更新 Gist 數據失敗'
      });
    }

    console.log(`📊 成功儲存數據: ${VIDEO_ID} - ${viewCount} 次觀看 (${currentDate} ${currentHour}:00)`);

    // 8. 成功回應
    res.status(200).json({ 
      success: true,
      message: '數據獲取並儲存成功',
      data: newEntry,
      gistUpdated: true,
      totalEntries: currentData.length,
      // 新增提示信息
      note: '此版本會保留所有記錄，建議定期檢查Gist文件大小'
    });

  } catch (error) {
    // 9. 全局錯誤處理
    console.error('❌ 處理過程中發生未預期錯誤:', error);
    res.status(500).json({ 
      success: false,
      error: '內部伺服器錯誤',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export const config = {
  runtime: 'nodejs',
};