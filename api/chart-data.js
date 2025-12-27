// api/chart-data.js - 【完整修改版】
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GIST_ID || !GITHUB_TOKEN) {
    return res.status(500).json({ 
      error: 'Server configuration error' 
    });
  }

  try {
    // 【新增】從查詢參數獲取影片ID，預設第一個影片
    const { 
      videoId = ALL_VIDEO_IDS[0],  // 預設第一個影片
      range,       
      interval,    
      stats,       
      limit        
    } = req.query;

    console.log(`📡 API請求: videoId=${videoId}, range=${range}, interval=${interval}`);

    // 【新增】驗證影片ID是否在追蹤清單中
    if (!ALL_VIDEO_IDS.includes(videoId)) {
      return res.status(400).json({
        success: false,
        error: `未追蹤的影片ID: ${videoId}`,
        availableVideos: ALL_VIDEO_IDS,
        suggestion: `請使用以下ID之一: ${ALL_VIDEO_IDS.join(', ')}`
      });
    }

    // 【修改】從Gist讀取對應影片的數據文件
    const fileName = `youtube-data-${videoId}.json`;  // 每個影片獨立檔案
    
    // 先嘗試讀取影片特定檔案
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'vercel-app'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch gist data' 
      });
    }

    const gistData = await response.json();
    
    let allData = [];
    
    // 情況1：找到影片特定檔案
    if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        allData = JSON.parse(gistData.files[fileName].content);
        console.log(`📂 找到 ${fileName}: ${allData.length} 條記錄`);
      } catch (parseError) {
        console.error(`解析 ${fileName} 失敗:`, parseError);
        allData = [];
      }
    } 
    // 情況2：沒找到，但可能是舊格式的通用檔案（向後兼容）
    else if (videoId === 'm2ANkjMRuXc' && gistData.files && gistData.files['youtube-data.json']) {
      console.log('⚠️ 使用舊格式檔案，將遷移到新格式...');
      try {
        allData = JSON.parse(gistData.files['youtube-data.json'].content);
        console.log(`🔄 從舊格式遷移: ${allData.length} 條記錄`);
      } catch (parseError) {
        console.error('解析舊格式檔案失敗:', parseError);
        allData = [];
      }
    }
    // 情況3：完全沒有數據
    else {
      console.log(`📭 沒有找到影片 ${videoId} 的數據，返回空數組`);
    }

    // 確保數據按時間排序
    allData.sort((a, b) => a.timestamp - b.timestamp);

    // ========== 處理查詢參數 ==========
    // 1. 時間範圍篩選
    let filteredData = allData;
    if (range && range !== 'all') {
      const hours = parseInt(range);
      if (!isNaN(hours) && hours > 0) {
        const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
        filteredData = allData.filter(item => item.timestamp > cutoffTime);
        console.log(`⏰ 時間範圍篩選: 保留 ${filteredData.length}/${allData.length} 條記錄`);
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
        
      console.log(`🕐 小時間隔處理: ${filteredData.length} → ${processedData.length} 條記錄`);
        
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
        
      console.log(`📅 天間隔處理: ${filteredData.length} → ${processedData.length} 條記錄`);
    }

    // 3. 限制返回條數
    if (limit && !isNaN(parseInt(limit))) {
      const limitNum = parseInt(limit);
      processedData = processedData.slice(-limitNum);
      console.log(`🔢 限制條數: ${limitNum} 條`);
    }

    // 4. 計算統計信息
    let statistics = null;
    if (stats === 'true' && processedData.length > 0) {
      const latest = processedData[processedData.length - 1];
      const earliest = processedData[0];
      
      const today = new Date().toDateString();
      const todayData = processedData.filter(item => 
        new Date(item.timestamp).toDateString() === today
      );
      
      const last24h = processedData.filter(item => 
        Date.now() - item.timestamp < 24 * 60 * 60 * 1000
      );
      
      statistics = {
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
          totalChange: processedData.length > 1 ? latest.viewCount - earliest.viewCount : 0,
          totalChangePercent: processedData.length > 1 && earliest.viewCount > 0 
            ? ((latest.viewCount - earliest.viewCount) / earliest.viewCount * 100).toFixed(2)
            : 0,
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
      
      console.log(`📊 統計信息計算完成`);
    }

    // ========== 【新增】獲取影片資訊 ==========
    const videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId) || {
      id: videoId,
      name: videoId,
      color: '#0070f3',
      description: `YouTube 影片: ${videoId}`
    };

    // ========== 智能返回格式 ==========
    // 檢查是否有查詢參數
    const hasQueryParams = range || interval || stats || limit;
    
    // 設置緩存頭
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    if (!hasQueryParams) {
      // 情況1：沒有查詢參數 → 返回舊格式（純數組，完全向後兼容）
      console.log(`📊 返回影片 ${videoId} 的舊格式，${processedData.length} 條數據`);
      return res.status(200).json(processedData);
      
    } else {
      // 情況2：有查詢參數 → 返回新格式
      console.log(`📊 返回影片 ${videoId} 的新格式，${processedData.length} 條數據`);
      
      const responseData = {
        success: true,
        data: processedData,
        videoInfo: {
          id: videoId,
          name: videoInfo?.name || videoId,
          color: videoInfo?.color || '#0070f3',
          description: videoInfo?.description || `YouTube 影片: ${videoId}`
        },
        meta: {
          requestedAt: new Date().toISOString(),
          videoId,
          params: { range, interval, stats, limit },
          originalCount: allData.length,
          returnedCount: processedData.length,
          compatibility: 'new-format'
        }
      };

      // 如果有統計信息，添加到響應中
      if (statistics) {
        responseData.statistics = statistics;
      }

      return res.status(200).json(responseData);
    }

  } catch (error) {
    console.error('Error in chart-data API:', error);
    
    const errorResponse = {
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    return res.status(500).json(errorResponse);
  }
}