// api/chart-data.js
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
    // 從Gist讀取數據
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
    const fileName = 'youtube-data.json';
    
    let allData = [];
    if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        allData = JSON.parse(gistData.files[fileName].content);
      } catch (parseError) {
        console.error('Failed to parse gist content:', parseError);
        return res.status(500).json({ 
          error: 'Failed to parse gist data' 
        });
      }
    }

    // 確保數據按時間排序
    allData.sort((a, b) => a.timestamp - b.timestamp);

    // ========== 處理查詢參數 ==========
    const { 
      range,       // 時間範圍（小時數）
      interval,    // 數據間隔
      stats,       // 是否返回統計信息
      limit        // 限制返回條數
    } = req.query;

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
    }

    // ========== 【關鍵修改】智能返回格式 ==========
    // 檢查是否有查詢參數
    const hasQueryParams = range || interval || stats || limit;
    
    // 設置緩存頭
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    if (!hasQueryParams) {
      // 情況1：沒有查詢參數 → 返回舊格式（純數組，完全向後兼容）
      console.log(`📊 API: 返回舊格式（數組），${processedData.length} 條數據`);
      return res.status(200).json(processedData);
      
    } else {
      // 情況2：有查詢參數 → 返回新格式
      console.log(`📊 API: 返回新格式（對象），${processedData.length} 條數據，參數：`, { range, interval, stats, limit });
      
      const responseData = {
        success: true,
        data: processedData,
        meta: {
          requestedAt: new Date().toISOString(),
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
    
    // 錯誤時也保持格式一致
    const errorResponse = {
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    return res.status(500).json(errorResponse);
  }
}