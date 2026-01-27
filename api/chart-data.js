// api/chart-data.js
import { requireEnv, sendEnvError } from './_lib/env.js';

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

// 【新增】全域常量
const MS_24H = 24 * 60 * 60 * 1000; // 24小時的毫秒數

// ========== 【新增】In-Memory Cache ==========
const GIST_CACHE_TTL = 60 * 1000; // 60 秒
const YOUTUBE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小時

let cacheGist = { value: null, expiresAt: 0 };
const cacheYoutubeInfo = new Map(); // videoId -> { value, expiresAt }

/**
 * 檢查並返回有效的 gist cache
 * @returns {{ gistData: object, cacheStatus: 'hit' | 'miss' } | null}
 */
function getCachedGist() {
    if (cacheGist.value && Date.now() < cacheGist.expiresAt) {
        return { gistData: cacheGist.value, cacheStatus: 'hit' };
    }
    return null;
}

/**
 * 設置 gist cache
 */
function setGistCache(gistData) {
    cacheGist = {
        value: gistData,
        expiresAt: Date.now() + GIST_CACHE_TTL
    };
}

/**
 * 檢查並返回有效的 YouTube cache
 * @returns {{ videoInfo: object, cacheStatus: 'hit' | 'miss' } | null}
 */
function getCachedYoutubeInfo(videoId) {
    const cached = cacheYoutubeInfo.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
        return { videoInfo: cached.value, cacheStatus: 'hit' };
    }
    return null;
}

/**
 * 設置 YouTube cache
 */
function setYoutubeCache(videoId, videoInfo) {
    cacheYoutubeInfo.set(videoId, {
        value: videoInfo,
        expiresAt: Date.now() + YOUTUBE_CACHE_TTL
    });
}

// 【新增】時間戳正規化 helper
// 支援 number timestamp 與 ISO string
// 無法解析時返回 null 並打印 warn
function normalizeTs(ts) {
    if (ts === null || ts === undefined) {
        return null;
    }
    
    // 如果已經是 number，直接返回
    if (typeof ts === 'number') {
        return ts;
    }
    
    // 如果是 ISO string，嘗試解析
    if (typeof ts === 'string') {
        const parsed = Date.parse(ts);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    
    // 無法解析
    console.warn('⚠️ [normalizeTs] 無法解析時間戳:', ts);
    return null;
}

// 預設值
let TRACKED_VIDEOS = DEFAULT_TRACKED_VIDEOS;
let ALL_VIDEO_IDS = DEFAULT_ALL_VIDEO_IDS;

// 【修改】計算最近 24 小時播放量（使用 gist 數據）
// 支援新舊資料格式：
// - 新版：data.snapshots = [{ ts, views_total }, ...]（小時/分鐘級別快照）
// - 舊版：data = [{ timestamp, viewCount }, ...]（累積數據陣列）
// - ts 支援 number 與 ISO string
function computeViewsLast24h(data, now = Date.now()) {
    const NOW = now;
    const BOUNDARY_24H_AGO = NOW - MS_24H;
    
    // 嘗試解析數據為 snapshots 格式
    let snapshots = [];
    
    if (Array.isArray(data)) {
        // 舊版格式：[{ timestamp, viewCount, ... }, ...]
        // 新版格式：[{ ts, views_total, ... }, ...]
        snapshots = data.map(item => {
            const ts = normalizeTs(item.timestamp || item.ts);
            if (ts === null) {
                console.warn('⚠️ [24h] 跳過無效的時間戳記錄:', item);
                return null;
            }
            return {
                ts: ts,
                views_total: item.viewCount || item.views_total || 0
            };
        }).filter(item => item !== null);
    } else if (data && Array.isArray(data.snapshots)) {
        // 新版格式：{ snapshots: [{ ts, views_total }, ...] }
        snapshots = data.snapshots.map(item => {
            const ts = normalizeTs(item.ts || item.timestamp);
            if (ts === null) {
                console.warn('⚠️ [24h] 跳過無效的時間戳記錄:', item);
                return null;
            }
            return {
                ts: ts,
                views_total: item.views_total || item.viewCount || 0
            };
        }).filter(item => item !== null);
    } else {
        // 數據格式無法識別
        console.warn('⚠️ [24h] 無法識別的數據格式');
        return { views: null, reason: 'invalid_format' };
    }
    
    if (snapshots.length === 0) {
        console.warn('⚠️ [24h] 沒有有效的數據記錄');
        return { views: null, reason: 'no_valid_data' };
    }
    
    // 按時間戳排序（由舊到新）
    snapshots.sort((a, b) => a.ts - b.ts);
    
    // 需要至少 2 筆數據才能計算差值
    if (snapshots.length < 2) {
        console.warn('⚠️ [24h] 數據不足，只有', snapshots.length, '筆');
        return { views: null, reason: 'insufficient_data', count: snapshots.length };
    }
    
    // 找到 ts <= NOW 的最新一筆作為 current
    let current = null;
    for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].ts <= NOW) {
            current = snapshots[i];
            break;
        }
    }
    
    // 如果沒有找到 <= NOW 的數據，使用最後一筆
    if (!current) {
        current = snapshots[snapshots.length - 1];
    }
    
    // 【修改】在所有數據點中尋找最接近 BOUNDARY_24H_AGO 的點（無論方向）
    // 這樣確保使用最接近 24 小時前的數據，而不是只取 >= 24 小時前的點
    let base = null;
    let baseDiff = Infinity;
    
    for (const snapshot of snapshots) {
        const diff = Math.abs(snapshot.ts - BOUNDARY_24H_AGO);
        if (diff < baseDiff) {
            baseDiff = diff;
            base = snapshot;
        }
    }
    
    // 檢查找到的 base 是否在合理範圍內（48 小時內）
    if (base) {
        const windowHours = (current.ts - base.ts) / MS_24H;
        if (windowHours < 23.5) {
            // 窗口小於 23.5 小時，嘗試找更早的數據點
            console.warn(`⚠️ [24h] 窗口只有 ${windowHours.toFixed(2)} 小時，嘗試找更早的數據點`);
            
            // 尋找所有 < BOUNDARY_24H_AGO 的點中，最接近 BOUNDARY_24H_AGO 的一個
            let earlierBase = null;
            let earlierDiff = Infinity;
            
            for (const snapshot of snapshots) {
                if (snapshot.ts < BOUNDARY_24H_AGO) {
                    const diff = BOUNDARY_24H_AGO - snapshot.ts; // 正數差值
                    if (diff < earlierDiff) {
                        earlierDiff = diff;
                        earlierBase = snapshot;
                    }
                }
            }
            
            // 如果有更早且窗口大於 23.5 小時的點，使用它
            if (earlierBase) {
                const earlierWindowHours = (current.ts - earlierBase.ts) / MS_24H;
                if (earlierWindowHours >= 23.5) {
                    base = earlierBase;
                    baseDiff = earlierDiff;
                    console.log(`✅ [24h] 使用更早的數據點，窗口: ${earlierWindowHours.toFixed(2)} 小時`);
                }
            }
        }
        
        // 最終檢查：如果窗口仍然太小（< 22 小時），標記為數據不足
        const finalWindowHours = (current.ts - base.ts) / MS_24H;
        if (finalWindowHours < 22) {
            console.warn(`⚠️ [24h] 窗口只有 ${finalWindowHours.toFixed(2)} 小時，數據可能不足以計算準確的 24h`);
        }
    } else {
        // 沒有找到任何數據點
        console.warn('⚠️ [24h] 沒有數據點，無法計算 24h');
        return { views: null, reason: 'no_data_24h_ago' };
    }
    
    // 計算差值，確保不為負數
    const views = Math.max(0, current.views_total - base.views_total);
    
    console.log(`📊 [24h] 計算結果: ${views.toLocaleString()} views`);
    console.log(`   Current: ts=${current.ts}, views_total=${current.views_total}`);
    console.log(`   Base: ts=${base.ts}, views_total=${base.views_total}`);
    console.log(`   Window: ${new Date(base.ts).toISOString()} ~ ${new Date(current.ts).toISOString()}`);
    
    return {
        views: views,
        current: current,
        base: base,
        window: {
            start: new Date(base.ts).toISOString(),
            end: new Date(current.ts).toISOString(),
            hours: (current.ts - base.ts) / MS_24H
        }
    };
}

// 【修改】從 gist 數據計算今日增長（本地時區，香港 UTC+8）
function computeTodayGrowth(data, now = Date.now()) {
    const NOW = now;
    
    // 香港時間的今天開始（00:00 HKT）
    const hkNow = new Date(NOW + (8 * 3600000));
    const hkTodayStart = new Date(hkNow.getFullYear(), hkNow.getMonth(), hkNow.getDate());
    const hkTodayStartUTC = hkTodayStart.getTime() - (8 * 3600000);
    const hkTodayEndUTC = hkTodayStartUTC + MS_24H; // 使用全域常量 MS_24H
    
    // 嘗試解析數據
    let snapshots = [];
    
    if (Array.isArray(data)) {
        snapshots = data.map(item => {
            const ts = normalizeTs(item.timestamp || item.ts);
            if (ts === null) {
                console.warn('⚠️ [todayGrowth] 跳過無效的時間戳記錄:', item);
                return null;
            }
            return {
                ts: ts,
                views_total: item.viewCount || item.views_total || 0
            };
        }).filter(item => item !== null);
    } else if (data && Array.isArray(data.snapshots)) {
        snapshots = data.snapshots.map(item => {
            const ts = normalizeTs(item.ts || item.timestamp);
            if (ts === null) {
                console.warn('⚠️ [todayGrowth] 跳過無效的時間戳記錄:', item);
                return null;
            }
            return {
                ts: ts,
                views_total: item.views_total || item.viewCount || 0
            };
        }).filter(item => item !== null);
    }
    
    if (snapshots.length === 0) {
        console.warn('⚠️ [todayGrowth] 沒有有效的數據記錄');
        return { growth: null, reason: 'no_valid_data' };
    }
    
    // 按時間戳排序
    snapshots.sort((a, b) => a.ts - b.ts);
    
    // 找到今天的數據
    const todayData = snapshots.filter(item => 
        item.ts >= hkTodayStartUTC && item.ts < hkTodayEndUTC
    );
    
    if (todayData.length < 2) {
        return { growth: null, reason: 'insufficient_data', count: todayData.length };
    }
    
    const first = todayData[0];
    const last = todayData[todayData.length - 1];
    const growth = Math.max(0, last.views_total - first.views_total);
    
    return {
        growth: growth,
        first: first,
        last: last,
        count: todayData.length
    };
}

// 【修正】從 YouTube Analytics API 獲取最近 24 小時播放量（備用方案）
async function getLast24ViewsHourly(channelId, localTimezone = "Asia/Hong_Kong") {
    if (!YOUTUBE_ANALYTICS_API_KEY || !channelId) {
        console.warn('⚠️ 缺少 YouTube Analytics API Key 或 Channel ID，無法獲取 24h 數據');
        return { views_last_24h: 0, last_24h_window: null, error: 'missing_config' };
    }

    try {
        const now = new Date();
        const nowMs = now.getTime();
        
        // ========== 計算太平洋時區（YouTube Analytics 使用 Pacific 時間）==========
        const month = now.getUTCMonth();
        const dayOfMonth = now.getUTCDate();
        const dayOfWeek = now.getUTCDay();
        
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
        
        const nowPacificMs = nowMs + pacificOffsetMs;
        const endPacific = new Date(nowPacificMs);
        endPacific.setUTCMinutes(0, 0, 0);
        
        const startPacific = new Date(endPacific.getTime() - 24 * 60 * 60 * 1000);
        
        const startDate = startPacific.toISOString().split('T')[0];
        const endDate = endPacific.toISOString().split('T')[0];
        
        console.log(`📊 [24h Analytics] API 日期範圍: ${startDate} 到 ${endDate}`);

        const url = `${YOUTUBE_ANALYTICS_API_BASE}?ids=channel==${channelId}&startDate=${startDate}&endDate=${endDate}&metrics=views&dimensions=day,hour&timeZone=America/Los_Angeles&key=${YOUTUBE_ANALYTICS_API_KEY}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ [24h Analytics] API 錯誤: ${response.status}`);
            return { views_last_24h: 0, last_24h_window: null, error: `API ${response.status}` };
        }
        
        const data = await response.json();
        
        if (!data.rows || data.rows.length === 0) {
            console.warn('⚠️ [24h Analytics] 無數據返回');
            return { views_last_24h: 0, last_24h_window: null, error: 'no_data' };
        }
        
        // 解析數據
        const headers = data.columnHeaders || [];
        let dayIndex = headers.findIndex(h => h.name === 'day');
        let hourIndex = headers.findIndex(h => h.name === 'hour');
        let viewsIndex = headers.findIndex(h => h.name === 'views');
        
        if (dayIndex === -1) dayIndex = 0;
        if (hourIndex === -1) hourIndex = 1;
        if (viewsIndex === -1) viewsIndex = 2;
        
        const startPacificMs = startPacific.getTime();
        const endPacificMs = endPacific.getTime();
        
        let totalViews = 0;
        
        data.rows.forEach((row, idx) => {
            const dayStr = row[dayIndex];
            const hour = parseInt(row[hourIndex]);
            const views = parseInt(row[viewsIndex]) || 0;
            
            const [year, month, day] = dayStr.split('-').map(Number);
            const dtPacific = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
            const dtMs = dtPacific.getTime();
            
            if (dtMs >= startPacificMs && dtMs < endPacificMs) {
                totalViews += views;
            }
        });

        console.log(`✅ [24h Analytics] 總計: ${totalViews} views`);

        let localOffsetMinutes = localTimezone === "Asia/Hong_Kong" ? 8 * 60 : now.getTimezoneOffset();
        const startLocal = new Date(startPacificMs - localOffsetMinutes * 60 * 1000);
        const endLocal = new Date(endPacificMs - localOffsetMinutes * 60 * 1000);

        return {
            views_last_24h: totalViews,
            last_24h_window: {
                start: startLocal.toISOString(),
                end: endLocal.toISOString(),
                timezone: localTimezone,
                source: 'analytics_api'
            }
        };
        
    } catch (error) {
        console.error('❌ [24h Analytics] 錯誤:', error.message);
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

  // 【修改】使用 requireEnv 檢查必要環境變數
  const env = requireEnv(['GIST_ID', 'GITHUB_TOKEN']);
  if (!env.ok) {
    return sendEnvError(res, env.missing, { endpoint: 'chart-data' });
  }

  // 【新增】Debug probe（非 production）
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__chartDataProbe = (globalThis.__chartDataProbe || 0) + 1;
    console.log('[chart-data] probe', { 
      count: globalThis.__chartDataProbe, 
      expiresAt: cacheGist.expiresAt, 
      now: Date.now() 
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
      refreshConfig,
      includeVideoInfo  // 【新增】控制是否獲取 YouTube 影片資訊
    } = req.query;

    const shouldIncludeVideoInfo = includeVideoInfo === 'true';
    console.log(`📡 API請求: videoId=${videoId}, range=${range}, interval=${interval}, includeVideoInfo=${shouldIncludeVideoInfo}`);

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

    // 【修改】從Gist讀取對應影片的數據文件（使用 Cache）
    const fileName = `youtube-data-${videoId}.json`;  // 每個影片獨立檔案
    
    // 初始化 cache 狀態
    let cacheGistStatus = 'miss';
    let cacheYoutubeStatus = 'skipped';
    
    // Gist cache 邏輯：直接使用 module-scope cacheGist 變數
    const now = Date.now();
    let gistData;
    
    if (cacheGist.value && now < cacheGist.expiresAt) {
      // Cache hit
      gistData = cacheGist.value;
      cacheGistStatus = 'hit';
    } else {
      // Cache miss，fetch from GitHub
      const response = await fetch(`https://api.github.com/gists/${env.values.GIST_ID}`, {
        headers: {
          'Authorization': `token ${env.values.GITHUB_TOKEN}`,
          'User-Agent': 'vercel-app'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ 
          error: 'Failed to fetch gist data',
          gistError: response.statusText
        });
      }

      gistData = await response.json();
      
      // 設置 gist cache
      cacheGist = {
        value: gistData,
        expiresAt: now + 60 * 1000  // TTL: 60 秒
      };
      cacheGistStatus = 'miss';
    }
    
    // Debug log（非 production）
    if (process.env.NODE_ENV !== 'production') {
      console.log('[chart-data] gistCache', { 
        hit: cacheGistStatus === 'hit', 
        expiresAt: cacheGist.expiresAt, 
        now 
      });
    }
    
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
    if (stats === 'true') {
      // 【修改】首先使用本地數據計算最近 24 小時播放量
      // 傳入 allData 以獲得更完整的歷史數據
      const last24hFromGist = computeViewsLast24h(allData, Date.now());
      
      // 如果本地計算成功，使用本地結果；否則嘗試使用 Analytics API
      let viewsLast24h;
      let last24hWindow;
      let viewsLast24hSource = 'gist';
      
      if (last24hFromGist.views !== null) {
        // 本地計算成功
        viewsLast24h = last24hFromGist.views;
        last24hWindow = last24hFromGist.window;
        console.log(`✅ [24h] 使用 gist 數據計算: ${viewsLast24h} views`);
      } else {
        // 本地計算失敗，回退到 Analytics API
        console.warn(`⚠️ [24h] gist 數據不足 (${last24hFromGist.reason})，嘗試使用 Analytics API`);
        const apiResult = await getLast24ViewsHourly(YOUTUBE_CHANNEL_ID, "Asia/Hong_Kong");
        
        if (apiResult && apiResult.views_last_24h > 0) {
          viewsLast24h = apiResult.views_last_24h;
          last24hWindow = apiResult.last_24h_window;
          viewsLast24hSource = 'analytics_api';
          console.log(`✅ [24h] 使用 Analytics API: ${viewsLast24h} views`);
        } else {
          // API 也失敗，標記為需要 fallback
          viewsLast24h = null;
          last24hWindow = null;
          viewsLast24hSource = 'unavailable';
          console.warn(`⚠️ [24h] 無法獲取 24h 數據`);
        }
      }
      
      const latest = processedData[processedData.length - 1];
      const earliest = processedData[0];
      
      // 【修改】使用香港時間 (UTC+8) 計算今日數據
      function getHongKongTodayRange() {
        const now = new Date();
        const hkNow = new Date(now.getTime() + (8 * 3600000));
        const hkToday = new Date(hkNow.getFullYear(), hkNow.getMonth(), hkNow.getDate());
        const todayStartUTC = hkToday.getTime() - (8 * 3600000);
        const todayEndUTC = todayStartUTC + 24 * 60 * 60 * 1000;
        return { todayStartUTC, todayEndUTC };
      }
      
      const { todayStartUTC, todayEndUTC } = getHongKongTodayRange();
      
      const todayData = processedData.filter(item => 
        item.timestamp >= todayStartUTC && item.timestamp < todayEndUTC
      );
      
      // 【新增】計算今日增長（用於 fallback）
      const todayGrowthResult = computeTodayGrowth(allData, Date.now());
      const todayGrowth = todayGrowthResult.growth;
      
      const last24h = processedData.filter(item => 
        Date.now() - item.timestamp < 24 * 60 * 60 * 1000
      );
      
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
        // 【修改】最近 24 小時播放量（優先使用 gist 數據計算）
        analytics: {
          views_last_24h: viewsLast24h,
          views_last_24h_source: viewsLast24hSource,
          last_24h_window: last24hWindow,
          fallback: {
            available: todayGrowth !== null,
            today_growth: todayGrowth,
            message: viewsLast24h === null ? 
              (todayGrowth !== null ? 'Insufficient data for rolling 24h, showing today growth (Estimated)' : 'No data available') 
              : null
          }
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
          likeCountChange: hasLikeCount && processedData.length > 1 ? latestLikeCount - earliestLikeCount : null,
          likeCountChangePercent: hasLikeCount && processedData.length > 1 && earliestLikeCount > 0 
            ? ((latestLikeCount - earliestLikeCount) / earliestLikeCount * 100).toFixed(2)
            : null
        },
        peaks: {
          maxViewCount: Math.max(...processedData.map(d => d.viewCount)),
          minViewCount: Math.min(...processedData.map(d => d.viewCount)),
          avgViewCount: Math.round(processedData.reduce((sum, d) => sum + d.viewCount, 0) / processedData.length),
          maxLikeCount: hasLikeCount ? Math.max(...processedData.map(d => d.likeCount || 0)) : null,
          minLikeCount: hasLikeCount ? Math.min(...processedData.map(d => d.likeCount || 0)) : null,
          avgLikeCount: hasLikeCount ? Math.round(processedData.reduce((sum, d) => sum + (d.likeCount || 0), 0) / processedData.length) : null
        }
      };
      
      console.log(`📊 統計信息計算完成，24h來源: ${viewsLast24hSource}`);
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

    // 【修改】從YouTube API獲取影片資訊（使用 includeVideoInfo 參數控制）
    let youtubeVideoInfo = null;
    
    if (shouldIncludeVideoInfo && YOUTUBE_API_KEY && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      // 檢查 YouTube cache
      const cachedYoutube = getCachedYoutubeInfo(videoId);
      
      if (cachedYoutube) {
        // Cache hit
        youtubeVideoInfo = cachedYoutube.videoInfo;
        cacheYoutubeStatus = 'hit';
        console.log(`📦 [cache] YouTube cache hit for ${videoId}`);
      } else {
        // Cache miss，fetch from YouTube
        try {
          youtubeVideoInfo = await getVideoInfoFromYouTube(videoId);
          
          if (youtubeVideoInfo) {
            // 設置 YouTube cache
            setYoutubeCache(videoId, youtubeVideoInfo);
            cacheYoutubeStatus = 'miss';
            console.log(`💾 [cache] YouTube data cached for ${videoId} (TTL: 6h)`);
          }
        } catch (ytError) {
          console.warn(`⚠️ 獲取YouTube影片資訊失敗: ${ytError.message}`);
          cacheYoutubeStatus = 'error';
        }
      }
      
      if (youtubeVideoInfo) {
        videoInfo.publishDate = youtubeVideoInfo.publishDate;
        console.log(`✅ 使用YouTube API的發佈日期: ${videoInfo.publishDate}`);
      }
    } else {
      // 不獲取 YouTube 影片資訊，保持 youtubeVideoInfo 為 null
      console.log(`⏭️ [cache] YouTube API 跳過（includeVideoInfo=${shouldIncludeVideoInfo}）`);
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
    
    // 【修改】無論是否有查詢參數，都返回統一格式
    // 這確保即使影片沒有數據，也不會返回 500
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
        params: { range, interval, stats, limit, includeVideoInfo },
        originalCount: allData.length,
        returnedCount: processedData.length,
        compatibility: 'new-format',
        hasLikeCount: processedData.some(item => item.likeCount !== undefined),
        // 【新增】Cache 狀態
        cache: {
          gist: cacheGistStatus,
          youtube: cacheYoutubeStatus
        }
      }
    };

    // 如果有統計信息，添加到響應中
    if (statistics) {
      responseData.statistics = statistics;
    }

    console.log(`📊 返回影片 ${videoId} 的數據，${processedData.length} 條記錄`);
    return res.status(200).json(responseData);

  } catch (error) {
    // 【修改】改進錯誤處理，避免泄露敏感資訊
    console.error('❌ [chart-data] Error:', {
      name: error.name,
      message: error.message,
      stack: error.stack // 在伺服器端記錄完整堆疊
    });
    
    // 回應給前端只保留安全的訊息
    const errorResponse = {
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while processing your request.',
      timestamp: new Date().toISOString()
    };
    
    return res.status(500).json(errorResponse);
  }
}
