// api/quota-manager.js
/**
 * YouTube API Quota Manager
 * 追蹤並管理 YouTube Data API v3 的配額使用量
 */

// 環境變數配置
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const QUOTA_LIMIT = 10000; // YouTube API 每日配額上限

// API 端點成本定義
const API_COSTS = {
    'videos.list': 1,
    'search.list': 100,
    'channels.list': 1,
    'playlistItems.list': 1,
    'playlists.list': 1,
    'comments.list': 1,
    'commentThreads.list': 1
};

// 記憶體快取（用於 Serverless 環境的短期快取）
let memoryCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1分鐘快取

/**
 * 獲取 PT 時區的當地日期
 * @returns {string} 格式: YYYY-MM-DD
 */
function getPTDateString() {
    // PT 是 UTC-8 或 UTC-7，視夏令時間而定
    const now = new Date();
    const utcOffset = now.getTimezoneOffset() === 480 ? -8 : -7; // 480分鐘 = 8小時
    
    // 計算 PT 時間
    const ptTime = new Date(now.getTime() + (utcOffset * 60 * 1000));
    return ptTime.toISOString().split('T')[0];
}

/**
 * 獲取距離 PT 午夜的重置時間
 * @returns {Object} { hours, minutes, totalMilliseconds }
 */
function getTimeUntilReset() {
    const now = new Date();
    const utcOffset = now.getTimezoneOffset() === 480 ? -8 : -7;
    
    // 計算 PT 時間
    const ptNow = new Date(now.getTime() + (utcOffset * 60 * 1000));
    
    // 獲取 PT 午夜時間（今天）
    const ptMidnight = new Date(ptNow);
    ptMidnight.setHours(24, 0, 0, 0);
    
    // 如果已經過了午夜，則計算到明天的午夜
    if (ptNow >= ptMidnight) {
        ptMidnight.setDate(ptMidnight.getDate() + 1);
    }
    
    const diffMs = ptMidnight - ptNow;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
        hours,
        minutes,
        totalMilliseconds: diffMs
    };
}

/**
 * 從 Gist 讀取配額使用量
 * @returns {Promise<Object>} 配額狀態物件
 */
async function readQuotaFromGist() {
    if (!GIST_ID || !GITHUB_TOKEN) {
        console.warn('⚠️ Gist 環境變數未配置，無法讀取配額');
        return null;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'YouTube-Quota-Manager'
            }
        });

        if (!response.ok) {
            console.error(`❌ 讀取 Gist 失敗: ${response.status}`);
            return null;
        }

        const gist = await response.json();
        const quotaFile = gist.files['youtube-quota.json'];
        
        if (!quotaFile || !quotaFile.content) {
            return null;
        }

        return JSON.parse(quotaFile.content);
    } catch (error) {
        console.error('❌ 讀取配額 Gist 失敗:', error.message);
        return null;
    }
}

/**
 * 更新 Gist 配額資料
 * @param {Object} quotaData - 配額資料物件
 * @param {number} retries - 重試次數
 */
async function updateQuotaGist(quotaData, retries = 3) {
    if (!GIST_ID || !GITHUB_TOKEN) {
        console.warn('⚠️ Gist 環境變數未配置，無法更新配額');
        return false;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'YouTube-Quota-Manager'
            },
            body: JSON.stringify({
                files: {
                    'youtube-quota.json': {
                        content: JSON.stringify(quotaData, null, 2)
                    }
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gist API 錯誤: ${response.status}`);
        }

        return true;
    } catch (error) {
        console.error(`❌ 更新配額 Gist 失敗: ${error.message}`);
        
        if (retries > 0) {
            console.log(`🔄 重試中... (剩餘 ${retries} 次)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return updateQuotaGist(quotaData, retries - 1);
        }
        return false;
    }
}

/**
 * 追蹤 API 使用量
 * @param {string} endpoint - API 端點名稱
 * @param {number} customCost - 自訂成本（可選）
 * @returns {Promise<Object>} 更新後的配額狀態
 */
export async function trackApiUsage(endpoint, customCost = null) {
    const cost = customCost ?? API_COSTS[endpoint] ?? 1;
    const timestamp = new Date().toISOString();
    const today = getPTDateString();
    
    try {
        // 嘗試從 Gist 讀取當前配額
        let quotaData = await readQuotaFromGist();
        
        // 檢查是否需要重置
        if (!quotaData || quotaData.date !== today) {
            quotaData = {
                date: today,
                usage: 0,
                calls: []
            };
        }

        // 新增這次呼叫
        const newCall = {
            timestamp,
            endpoint,
            cost
        };
        
        quotaData.usage += cost;
        quotaData.calls.push(newCall);
        
        // 更新記憶體快取
        memoryCache = quotaData;
        cacheTimestamp = Date.now();
        
        // 非同步更新 Gist（不阻塞主流程）
        updateQuotaGist(quotaData).then(success => {
            if (!success) {
                console.warn('⚠️ 無法更新配額到 Gist，稍後將使用本地記錄');
            }
        }).catch(err => {
            console.warn('⚠️ 配額 Gist 更新失敗（背景任務）:', err.message);
        });
        
        return quotaData;
    } catch (error) {
        // 確保即使出錯也返回有效的配額狀態
        console.warn('⚠️ 配額追蹤發生錯誤，返回本地狀態:', error.message);
        return {
            date: today,
            usage: cost, // 至少記錄這次調用的成本
            calls: [{ timestamp, endpoint, cost }],
            error: error.message
        };
    }
}

/**
 * 獲取當前配額狀態
 * @returns {Promise<Object>} 配額狀態物件
 */
export async function getQuotaStatus() {
    const today = getPTDateString();
    
    // 檢查記憶體快取
    if (memoryCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        if (memoryCache.date === today) {
            return {
                ...memoryCache,
                limit: QUOTA_LIMIT,
                percentage: ((memoryCache.usage / QUOTA_LIMIT) * 100).toFixed(2),
                remaining: QUOTA_LIMIT - memoryCache.usage,
                resetTime: getTimeUntilReset()
            };
        }
    }

    // 從 Gist 讀取
    let quotaData = null;
    try {
        quotaData = await readQuotaFromGist();
    } catch (error) {
        console.error('❌ 讀取配額數據失敗:', error);
        // 返回初始狀態，不拋出錯誤
    }
    
    if (!quotaData || quotaData.date !== today) {
        // 需要重置或首次使用，或讀取失敗
        return {
            date: today,
            usage: 0,
            calls: [],
            limit: QUOTA_LIMIT,
            percentage: '0.00',
            remaining: QUOTA_LIMIT,
            resetTime: getTimeUntilReset()
        };
    }

    // 更新快取
    memoryCache = quotaData;
    cacheTimestamp = Date.now();
    
    return {
        ...quotaData,
        limit: QUOTA_LIMIT,
        percentage: ((quotaData.usage / QUOTA_LIMIT) * 100).toFixed(2),
        remaining: QUOTA_LIMIT - quotaData.usage,
        resetTime: getTimeUntilReset()
    };
}

/**
 * 檢查並重置配額（如有必要）
 * @returns {Promise<Object>} 重置後的配額狀態
 */
export async function resetQuotaIfNeeded() {
    const today = getPTDateString();
    let quotaData = await readQuotaFromGist();
    
    if (quotaData && quotaData.date === today) {
        return quotaData;
    }
    
    // 需要重置
    quotaData = {
        date: today,
        usage: 0,
        calls: []
    };
    
    await updateQuotaGist(quotaData);
    
    // 更新快取
    memoryCache = quotaData;
    cacheTimestamp = Date.now();
    
    return quotaData;
}

/**
 * 獲取 API 端點成本
 * @param {string} endpoint - 端點名稱
 * @returns {number} 成本單位
 */
export function getApiCost(endpoint) {
    return API_COSTS[endpoint] ?? 1;
}

/**
 * 獲取所有支援的端點及其成本
 * @returns {Object} 端點-成本對照表
 */
export function getApiCosts() {
    return { ...API_COSTS };
}

/**
 * 獲取配額限制
 * @returns {number} 配額限制
 */
export function getQuotaLimit() {
    return QUOTA_LIMIT;
}

export default {
    trackApiUsage,
    getQuotaStatus,
    resetQuotaIfNeeded,
    getApiCost,
    getApiCosts,
    getQuotaLimit
};
