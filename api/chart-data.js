// api/chart-data.js - 【完整修改版】
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

// 【修改】導入影片配置函數
import { 
    getUserVideoConfig,
    getVideoById,
    DEFAULT_TRACKED_VIDEOS,
    DEFAULT_ALL_VIDEO_IDS 
} from './videos-config.js';

// 【新增】YouTube Analytics API 配置
const YOUTUBE_ANALYTICS_API_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';
const YOUTUBE_ANALYTICS_API_KEY = process.env.YOUTUBE_ANALYTICS_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// 預設值
let TRACKED_VIDEOS = DEFAULT_TRACKED_VIDEOS;
let ALL_VIDEO_IDS = DEFAULT_ALL_VIDEO_IDS;

// 【修正】從 YouTube Analytics API 獲取最近 24 小時播放量
async function getLast24ViewsHourly(channelId, localTimezone = "Asia/Hong_Kong") {
    if (!YOUTUBE_ANALYTICS_API_KEY || !channelId) {
        console.warn('⚠️ 缺少 YouTube Analytics API Key 或 Channel ID，無法獲取 24h 數據');
        return { views_last_24h: 0, last_24h_window: null, error: 'missing_config' };
    }

    try {
        const now = new Date();
        const nowMs = now.getTime();
        
        // ========== 計算太平洋時區（YouTube Analytics 使用 Pacific 時間）==========
        // Pacific Time: UTC-8 (標準) 或 UTC-7 (夏令)
        
        // 檢查是否為夏令時間（太平洋時間）
        // 夏令時：3月第二個週日 2:00 到 11月第一個週日 2:00
        const month = now.getUTCMonth(); // 0-11，使用 UTC 避免本地時區影響
        const dayOfMonth = now.getUTCDate();
        const dayOfWeek = now.getUTCDay(); // 0-6 (週日)
        
        let isDST = false;
        if (month >= 2 && month <= 10) {
            if (month > 3 && month < 10) {
                isDST = true;
            } else if (month === 3) {
                const secondSunday = 8 + (7 - dayOfWeek) % 7;
                if (dayOfMonth >= secondSunday) isDST = true;
            } else if (month === 10) {
                const firstSunday = 1 + (7 - dayOfWeek) % 7;
                if (dayOfMonth < firstSunday) isDST = true;
            }
        }
        
        const pacificOffsetMs = isDST ? -7 * 60 * 60 * 1000 : -8 * 60 * 60 * 1000;
        
        // ========== 計算最近 24 小時的時間範圍 ==========
        // 結束時間：太平洋時間的現在時刻（取整點）
        const nowPacificMs = nowMs + pacificOffsetMs;
        const endPacific = new Date(nowPacificMs);
        endPacific.setUTCMinutes(0, 0, 0); // 整點
        
        // 開始時間：結束時間 - 24 小時
        const startPacific = new Date(endPacific.getTime() - 24 * 60 * 60 * 1000);
        
        // 格式化日期給 API
        const startDate = startPacific.toISOString().split('T')[0]; // YYYY-MM-DD
        const endDate = endPacific.toISOString().split('T')[0];     // YYYY-MM-DD
        
        console.log(`📊 [24h Views] 計算窗口`);
        console.log(`   太平洋時區: ${isDST ? 'PDT (UTC-7)' : 'PST (UTC-8)'}`);
        console.log(`   start_pacific: ${startPacific.toISOString()}`);
        console.log(`   end_pacific: ${endPacific.toISOString()}`);
        console.log(`   API日期範圍: ${startDate} 到 ${endDate}`);

        // ========== 使用 day,hour 維度獲取小時數據 ==========
        const url = `${YOUTUBE_ANALYTICS_API_BASE}?ids=channel==${channelId}&startDate=${startDate}&endDate=${endDate}&metrics=views&dimensions=day,hour&timeZone=America/Los_Angeles&key=${YOUTUBE_ANALYTICS_API_KEY}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ [24h Views] API 錯誤: ${response.status}`);
            const errorText = await response.text();
            console.error(`API錯誤詳情: ${errorText}`);
            return { views_last_24h: 0, last_24h_window: null, error: `API ${response.status}` };
        }
        
        const data = await response.json();
        
        if (!data.rows || data.rows.length === 0) {
            console.warn('⚠️ [24h Views] 無數據返回');
            return { views_last_24h: 0, last_24h_window: null, error: 'no_data' };
        }
        
        console.log(`📊 [24h Views] API返回 ${data.rows.length} 行數據`);
        
        // 解析 columnHeaders 確認欄位順序
        const headers = data.columnHeaders || [];
        let dayIndex = -1;
        let hourIndex = -1;
        let viewsIndex = -1;
        
        headers.forEach((header, index) => {
            if (header.name === 'day') dayIndex = index;
            else if (header.name === 'hour') hourIndex = index;
            else if (header.name === 'views') viewsIndex = index;
        });
        
        // 預設位置（如果 headers 解析失敗）
        if (dayIndex === -1) dayIndex = 0;
        if (hourIndex === -1) hourIndex = 1;
        if (viewsIndex === -1) viewsIndex = 2;
        
        // ========== 篩選並加總 ==========
        const startPacificMs = startPacific.getTime();
        const endPacificMs = endPacific.getTime();
        
        let totalViews = 0;
        let validRows = 0;
        
        data.rows.forEach((row, idx) => {
            // 解析 day 和 hour
            const dayStr = row[dayIndex]; // YYYY-MM-DD
            const hour = parseInt(row[hourIndex]); // 0-23
            const views = parseInt(row[viewsIndex]) || 0;
            
            // 組成 Pacific datetime
            const [year, month, day] = dayStr.split('-').map(Number);
            const dtPacific = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
            const dtMs = dtPacific.getTime();
            
            // 篩選：start <= dt < end
            if (dtMs >= startPacificMs && dtMs < endPacificMs) {
                totalViews += views;
                validRows++;
                console.log(`   [24h] ${idx}: ${dayStr} ${hour.toString().padStart(2, '0')}:00 (Pacific) → +${views} views`);
            }
        });

        console.log(`✅ [24h Views] 總計: ${totalViews} views (${validRows} 小時有效數據)`);

        // ========== 返回結果 ==========
        // 計算本地時區的時間窗口用於顯示
        let localOffsetMinutes;
        if (localTimezone === "Asia/Hong_Kong") {
            localOffsetMinutes = 8 * 60;
        } else {
            localOffsetMinutes = now.getTimezoneOffset();
        }
        
        const startLocal = new Date(startPacificMs - localOffsetMinutes * 60 * 1000);
        const endLocal = new Date(endPacificMs - localOffsetMinutes * 60 * 1000);

        return {
            views_last_24h: totalViews,
            last_24h_window: {
                start: startLocal.toISOString(),
                end: endLocal.toISOString(),
                timezone: localTimezone,
                pacificStart: startPacific.toISOString(),
                pacificEnd: endPacific.toISOString()
            }
        };
        
    } catch (error) {
        console.error('❌ [24h Views] API 錯誤:', error.message);
        return { views_last_24h: 0, last_24h_window: null, error: error.message };
    }
}

// 【新增】從YouTube API獲取影片資訊（包括上載日期）
async function getVideoInfoFromYouTube(videoId) {
    if (!YOUTUBE_API_KEY) {
        console.warn('⚠️ 沒有YouTube API Key，無法獲取影片資訊');
        return null;
    }

    try {
        const youtubeUrl = `${YOUTUBE_API_BASE}?id=${videoId}&part=snippet&key=${YOUTUBE_API_KEY}`;
        console.log(`🔍 從YouTube API獲取影片資訊: ${videoId}`);
        
        const response = await fetch(youtubeUrl);
        
        if (!response.ok) {
            console.error(`❌ YouTube API錯誤: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            console.error(`❌ 影片未找到: ${videoId}`);
            return null;
        }
        
        const snippet = data.items[0].snippet;
        const publishDate = snippet.publishedAt.split('T')[0]; // 格式: YYYY-MM-DD
        
        console.log(`✅ 從YouTube獲取到發佈日期: ${publishDate}`);
        
        return {
            title: snippet.title,
            description: snippet.description,
            publishDate: publishDate,
            channelTitle: snippet.channelTitle,
            thumbnails: snippet.thumbnails
        };
        
    } catch (error) {
        console.error(`❌ 獲取YouTube影片資訊失敗: ${error.message}`);
        return null;
    }
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
    // 【修改】動態獲取最新影片配置
    const config = await getUserVideoConfig();
    TRACKED_VIDEOS = config.TRACKED_VIDEOS;
    ALL_VIDEO_IDS = config.ALL_VIDEO_IDS;
    
    console.log('✅ 載入動態影片配置，追蹤影片數:', ALL_VIDEO_IDS.length);
    
    // 【新增】如果有配置刷新參數，更新配置後重新導向
    if (req.query.refreshConfig === 'true') {
      console.log('🔄 強制刷新影片配置...');
      // 重新載入配置
      const refreshedConfig = await getUserVideoConfig(true); // 傳入 true 強制刷新
      TRACKED_VIDEOS = refreshedConfig.TRACKED_VIDEOS;
      ALL_VIDEO_IDS = refreshedConfig.ALL_VIDEO_IDS;
      console.log('✅ 配置刷新完成，當前影片數:', ALL_VIDEO_IDS.length);
    }

    // 【新增】從查詢參數獲取影片ID，預設第一個影片
    const { 
      videoId = ALL_VIDEO_IDS[0],  // 預設第一個影片
      range,       
      interval,    
      stats,       
      limit,
      refreshConfig
    } = req.query;

    console.log(`📡 API請求: videoId=${videoId}, range=${range}, interval=${interval}`);

// 【修改】驗證影片ID是否在追蹤清單中
if (!ALL_VIDEO_IDS.includes(videoId)) {
  // 【新增】嘗試重新載入配置
  try {
    console.log(`⚠️ 影片ID ${videoId} 不在當前配置中，嘗試重新載入配置...`);
    const refreshedConfig = await getUserVideoConfig(true); // 強制刷新
    const refreshedIds = refreshedConfig.ALL_VIDEO_IDS;
    
    if (refreshedIds.includes(videoId)) {
      console.log(`✅ 重新載入後找到影片 ${videoId}，更新配置`);
      ALL_VIDEO_IDS = refreshedIds;
      TRACKED_VIDEOS = refreshedConfig.TRACKED_VIDEOS;
    } else {
      return res.status(400).json({
        success: false,
        error: `未追蹤的影片ID: ${videoId}`,
        availableVideos: refreshedIds,
        suggestion: `請使用以下ID之一: ${refreshedIds.join(', ')}`,
        note: '如果您剛剛添加了這個影片，可能需要等待幾秒鐘讓配置同步'
      });
    }
  } catch (refreshError) {
    console.error('重新載入配置失敗:', refreshError);
    return res.status(400).json({
      success: false,
      error: `未追蹤的影片ID: ${videoId}`,
      availableVideos: ALL_VIDEO_IDS,
      suggestion: `請使用以下ID之一: ${ALL_VIDEO_IDS.join(', ')}`
    });
  }
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
      // 【修改】獲取最近 24 小時播放量（使用整點計算）
      const last24Result = await getLast24ViewsHourly(YOUTUBE_CHANNEL_ID, "Asia/Hong_Kong");
      
      const latest = processedData[processedData.length - 1];
      const earliest = processedData[0];
      
      // 【修改】使用香港時間 (UTC+8) 計算今日數據
      // 注意：timestamp 是 UTC 時間戳，需要將香港時間轉換為 UTC 時間戳來匹配
      function getHongKongTodayRange() {
        const now = new Date();
        // 獲取香港時間的今天日期
        const hkNow = new Date(now.getTime() + (8 * 3600000));
        const hkToday = new Date(hkNow.getFullYear(), hkNow.getMonth(), hkNow.getDate());
        
        // 香港時間今天 00:00 = UTC 時間 (hkToday - 8小時)
        const todayStartUTC = hkToday.getTime() - (8 * 3600000);
        const todayEndUTC = todayStartUTC + 24 * 60 * 60 * 1000;
        
        return { todayStartUTC, todayEndUTC };
      }
      
      const { todayStartUTC, todayEndUTC } = getHongKongTodayRange();
      
      const todayData = processedData.filter(item => 
        item.timestamp >= todayStartUTC && item.timestamp < todayEndUTC
      );
      
      const last24h = processedData.filter(item => 
        Date.now() - item.timestamp < 24 * 60 * 60 * 1000
      );
      
      // 計算 likeCount 統計（如果數據中有 likeCount 字段）
      const hasLikeCount = processedData.some(item => item.likeCount !== undefined);
      const latestLikeCount = hasLikeCount ? latest.likeCount : null;
      const earliestLikeCount = hasLikeCount ? earliest.likeCount : null;
      
      statistics = {
        summary: {
          totalRecords: allData.length,
          filteredRecords: processedData.length,
          dateRange: {
            start: new Date(processedData[0].timestamp).toISOString(),
            end: new Date(processedData[processedData.length - 1].timestamp).toISOString()
          },
          hasLikeCount: hasLikeCount
        },
        // 【修改】最近 24 小時播放量（使用整點計算結果）
        analytics: {
          views_last_24h: last24Result?.views_last_24h ?? 0,
          last_24h_window: last24Result?.last_24h_window || null,
          error: last24Result?.error || null
        },
        current: {
          viewCount: latest.viewCount,
          likeCount: latestLikeCount,
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
            : 0,
          // 添加 likeCount 變化統計
          likeCountChange: hasLikeCount && processedData.length > 1 ? latestLikeCount - earliestLikeCount : null,
          likeCountChangePercent: hasLikeCount && processedData.length > 1 && earliestLikeCount > 0 
            ? ((latestLikeCount - earliestLikeCount) / earliestLikeCount * 100).toFixed(2)
            : null
        },
        peaks: {
          maxViewCount: Math.max(...processedData.map(d => d.viewCount)),
          minViewCount: Math.min(...processedData.map(d => d.viewCount)),
          avgViewCount: Math.round(processedData.reduce((sum, d) => sum + d.viewCount, 0) / processedData.length),
          // 添加 likeCount 峰值統計
          maxLikeCount: hasLikeCount ? Math.max(...processedData.map(d => d.likeCount || 0)) : null,
          minLikeCount: hasLikeCount ? Math.min(...processedData.map(d => d.likeCount || 0)) : null,
          avgLikeCount: hasLikeCount ? Math.round(processedData.reduce((sum, d) => sum + (d.likeCount || 0), 0) / processedData.length) : null
        }
      };
      
      console.log(`📊 統計信息計算完成，包含Like數統計: ${hasLikeCount}`);
    }

// ========== 【修改】獲取影片資訊 ==========
let videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);

if (!videoInfo) {
  console.warn(`⚠️ 未找到影片 ${videoId} 的詳細資訊，使用預設值`);
  
  // 【新增】嘗試使用 getVideoById 函數
  const detailedInfo = getVideoById(videoId);
  if (detailedInfo) {
    videoInfo = detailedInfo;
  } else {
    // 回退到預設值
    videoInfo = {
      id: videoId,
      name: videoId,
      color: '#0070f3',
      description: `YouTube 影片: ${videoId}`,
      uploadDate: null
    };
    
    // 【新增】如果是有效的YouTube ID格式，嘗試從YouTube獲取名稱
    if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      videoInfo.name = `YouTube影片 (${videoId})`;
      videoInfo.description = `YouTube影片播放量追蹤: ${videoId}`;
    }
  }
}

        // 【新增】優先從YouTube API獲取上載日期
        let youtubeVideoInfo = null;
        if (YOUTUBE_API_KEY && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            youtubeVideoInfo = await getVideoInfoFromYouTube(videoId);
            
            if (youtubeVideoInfo) {
                // 【修改】只使用YouTube API的發佈日期，保留配置中的名稱和描述
                // 不更新影片名稱和描述，保持配置中的簡潔版本
                
                // 【重要】總是使用YouTube API的發佈日期
                videoInfo.publishDate = youtubeVideoInfo.publishDate;
                console.log(`✅ 使用YouTube API的發佈日期: ${videoInfo.publishDate}`);
            }
        }

        // 如果沒有從YouTube獲取到發佈日期，使用配置中的
        if (!videoInfo.publishDate && videoInfo.publishDate !== null) {
            console.log(`⚠️ 無法從YouTube獲取發佈日期，使用配置中的值: ${videoInfo.publishDate || '無'}`);
        }

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
          description: videoInfo?.description || `YouTube 影片: ${videoId}`,
          publishDate: videoInfo?.publishDate || null,
          // 【新增】如果從YouTube獲取了資訊，添加額外字段
          ...(youtubeVideoInfo ? {
            youtubeTitle: youtubeVideoInfo.title,
            channelTitle: youtubeVideoInfo.channelTitle,
            thumbnailUrl: youtubeVideoInfo.thumbnails?.default?.url
          } : {})
        },
        meta: {
          requestedAt: new Date().toISOString(),
          videoId,
          params: { range, interval, stats, limit },
          originalCount: allData.length,
          returnedCount: processedData.length,
          compatibility: 'new-format',
          hasLikeCount: processedData.some(item => item.likeCount !== undefined)
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
