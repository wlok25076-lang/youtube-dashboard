// api/fetch-and-store-multi.js
import { URL, URLSearchParams } from 'url';
global.URL = URL;
global.URLSearchParams = URLSearchParams;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CRON_AUTH_TOKEN = process.env.CRON_AUTH_TOKEN;

// 【修改】導入影片配置函數和配額管理器
import { 
    getUserVideoConfig, 
    saveUserVideoConfig,
    getVideoById,
    DEFAULT_TRACKED_VIDEOS,
    DEFAULT_ALL_VIDEO_IDS 
} from './videos-config.js';

import { trackApiUsage, getQuotaStatus, resetQuotaIfNeeded } from './quota-manager.js';

// 【修改】影片配置 - 改為動態獲取
let TRACKED_VIDEOS = DEFAULT_TRACKED_VIDEOS;
let ALL_VIDEO_IDS = DEFAULT_ALL_VIDEO_IDS;

// ==================== 【新增】批量查詢功能 ====================

/**
 * 批量查詢 YouTube 影片數據
 * @param {string[]} videoIds - 影片 ID 陣列
 * @param {number} batchSize - 每批次的影片數量（預設 50）
 * @returns {Map<string, Object>} - 結果 Map，key 為 videoId
 */
async function batchFetchVideos(videoIds, batchSize = 50) {
    console.log(`\n📡 開始批量查詢 ${videoIds.length} 個影片 (每批 ${batchSize})...`);
    
    const results = new Map();
    const startTime = Date.now();
    
    // 去重複
    const uniqueIds = [...new Set(videoIds)];
    console.log(`📊 去重複後: ${uniqueIds.length} 個唯一影片ID`);
    
    // 移除無效的 ID
    const validIds = uniqueIds.filter(id => /^[a-zA-Z0-9_-]{11}$/.test(id));
    const invalidIds = uniqueIds.filter(id => !/^[a-zA-Z0-9_-]{11}$/.test(id));
    
    if (invalidIds.length > 0) {
        console.warn(`⚠️ 發現 ${invalidIds.length} 個無效的影片ID:`, invalidIds);
        // 標記為失敗
        invalidIds.forEach(id => {
            results.set(id, {
                success: false,
                error: '無效的 YouTube 影片ID格式',
                data: null
            });
        });
    }
    
    // 切分批次
    const batches = [];
    for (let i = 0; i < validIds.length; i += batchSize) {
        batches.push(validIds.slice(i, i + batchSize));
    }
    
    console.log(`📦 已分為 ${batches.length} 個批次`);
    
    // 計算預估配額消耗
    // YouTube Data API v3: videos.list (part=statistics,snippet) = 2 個配額單位/請求
    // 每個請求最多 50 個影片
    const quotaPerBatch = 2; // 每個請求消耗 2 配額
    const totalQuota = batches.length * quotaPerBatch;
    console.log(`💰 預估配額消耗: 每批次 ${quotaPerBatch} × ${batches.length} 批次 = ${totalQuota} 配額單元`);
    
    // 處理所有批次
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        
        console.log(`\n🔄 批次 ${batchNum}/${batches.length}: 查詢 ${batch.length} 個影片`);
        console.log(`   IDs: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? '...' : ''}`);
        
        try {
            // 構建 API URL
            const idsParam = batch.join(',');
            const youtubeUrl = `${YOUTUBE_API_BASE}?id=${idsParam}&part=statistics,snippet&key=${YOUTUBE_API_KEY}`;
            
            console.log(`   🔗 API URL: ${youtubeUrl.substring(0, 80)}...`);
            
            // 發送請求
            const youtubeResponse = await fetch(youtubeUrl);
            
            // 【新增】追蹤 API 配額使用（非同步，不阻塞）
            trackApiUsage('videos.list', 2).catch(err => {
                console.warn('⚠️ 配額追蹤失敗:', err.message);
            });
            
            if (!youtubeResponse.ok) {
                const errorText = await youtubeResponse.text();
                console.error(`   ❌ API 錯誤 (${youtubeResponse.status}):`, errorText.substring(0, 100));
                
                // 標記整個批次為失敗
                batch.forEach(id => {
                    results.set(id, {
                        success: false,
                        error: `YouTube API 錯誤: ${youtubeResponse.status}`,
                        data: null
                    });
                    totalFailed++;
                });
                continue;
            }
            
            const youtubeData = await youtubeResponse.json();
            
            // 處理成功返回的影片
            if (youtubeData.items && Array.isArray(youtubeData.items)) {
                const foundIds = new Set();
                
                youtubeData.items.forEach(item => {
                    const videoId = item.id;
                    foundIds.add(videoId);
                    
                    const viewCount = parseInt(item.statistics.viewCount, 10) || 0;
                    const likeCount = item.statistics.likeCount ? parseInt(item.statistics.likeCount, 10) : 0;
                    const publishDate = item.snippet.publishedAt.split('T')[0];
                    const title = item.snippet.title;
                    const channelTitle = item.snippet.channelTitle;
                    
                    results.set(videoId, {
                        success: true,
                        error: null,
                        data: {
                            videoId,
                            viewCount,
                            likeCount,
                            publishDate,
                            snippet: {
                                title,
                                channelTitle,
                                description: item.snippet.description,
                                thumbnails: item.snippet.thumbnails
                            }
                        }
                    });
                    
                    totalSuccessful++;
                });
                
                console.log(`   ✅ 成功獲取: ${youtubeData.items.length}/${batch.length} 個影片`);
                
                // 標記未找到的影片
                batch.forEach(id => {
                    if (!foundIds.has(id)) {
                        results.set(id, {
                            success: false,
                            error: '影片未找到或已被刪除',
                            data: null
                        });
                        totalFailed++;
                        console.warn(`   ⚠️ 影片未找到: ${id}`);
                    }
                });
            } else {
                console.error(`   ❌ API 返回無效數據`);
                batch.forEach(id => {
                    results.set(id, {
                        success: false,
                        error: 'API 返回無效數據',
                        data: null
                    });
                    totalFailed++;
                });
            }
            
        } catch (error) {
            console.error(`   ❌ 批次 ${batchNum} 處理失敗:`, error.message);
            batch.forEach(id => {
                results.set(id, {
                    success: false,
                    error: error.message,
                    data: null
                });
                totalFailed++;
            });
        }
        
        // 如果還有更多批次，等待一下避免觸發 API 限制
        if (i < batches.length - 1) {
            console.log(`   ⏳ 等待 100ms 後繼續下一批次...`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    // 統計結果
    const elapsedTime = Date.now() - startTime;
    console.log(`\n📊 批量查詢完成:`);
    console.log(`   ✅ 成功: ${totalSuccessful}`);
    console.log(`   ❌ 失敗: ${totalFailed}`);
    console.log(`   ⏱️ 總耗時: ${(elapsedTime / 1000).toFixed(2)} 秒`);
    console.log(`   💰 實際配額消耗: ${batches.length * 2} 單元`);
    
    return results;
}

export default async function handler(req, res) {
    // ==================== 【重要修改】優先處理影片管理操作 ====================
    const { action } = req.query;
    
    // 如果是影片管理操作（add/delete/update/get/verify/getTitle/quota），直接處理
    if (action === 'get' || action === 'add' || action === 'delete' || action === 'update' || action === 'verify' || action === 'getTitle' || action === 'quota') {
        console.log(`🎬 處理影片管理操作: ${action}`);
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

    // ==================== 正式邏輯（數據收集任務） ====================
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
        // 【重要】每次執行前都刷新影片配置
        console.log('🔄 刷新影片配置...');
        const config = await getUserVideoConfig();
        TRACKED_VIDEOS = config.TRACKED_VIDEOS;
        ALL_VIDEO_IDS = config.ALL_VIDEO_IDS;
        console.log(`✅ 載入動態影片配置，追蹤影片數: ${ALL_VIDEO_IDS.length}`);
        
        const results = [];
        const failedVideoIds = [];
        
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
        
        // ==================== 【新增】批量查詢功能 ====================
        console.log(`🚀 開始批量處理 ${ALL_VIDEO_IDS.length} 個影片...`);
        
        // 使用批量查詢獲取所有影片數據
        const batchResults = await batchFetchVideos(ALL_VIDEO_IDS);
        
        // 處理批量查詢結果
        const timestamp = Date.now();
        const currentDate = new Date(timestamp).toISOString().split('T')[0];
        const currentHour = new Date(timestamp).getHours();
        
        for (const videoId of ALL_VIDEO_IDS) {
            try {
                const batchResult = batchResults.get(videoId);
                const videoInfo = Object.values(TRACKED_VIDEOS).find(v => v.id === videoId);
                
                if (!batchResult || !batchResult.success) {
                    console.error(`\n❌ 影片 ${videoInfo?.name || videoId} 獲取失敗`);
                    results.push({
                        videoId,
                        success: false,
                        error: batchResult?.error || '未知錯誤',
                        stack: batchResult?.stack
                    });
                    failedVideoIds.push(videoId);
                    continue;
                }
                
                const { viewCount, likeCount, publishDate, snippet } = batchResult.data;
                
                console.log(`\n✅ 處理影片: ${videoInfo?.name || videoId} (${videoId})`);
                console.log(`   📊 播放量: ${viewCount.toLocaleString()}, Like數: ${likeCount.toLocaleString()}`);
                console.log(`   📅 發佈日期: ${publishDate}, 數據時間: ${currentDate} ${currentHour}:00`);
                
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
                    likeCount,
                    date: currentDate,
                    hour: currentHour,
                    videoId,
                    videoName: videoInfo?.name || videoId
                };
                
                currentData.push(newEntry);
                console.log(`   📝 添加新記錄: ${currentDate} ${currentHour}:00`);
                
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
                    likeCount,
                    viewCountFormatted: viewCount.toLocaleString(),
                    likeCountFormatted: likeCount.toLocaleString(),
                    totalEntries: currentData.length,
                    videoName: videoInfo?.name || videoId,
                    timestamp: new Date(timestamp).toISOString()
                });
                
                console.log(`   ✅ ${videoInfo?.name || videoId}: 總計 ${currentData.length} 條記錄`);
                
            } catch (error) {
                console.error(`\n   ❌ 處理影片 ${videoId} 失敗:`, error.message);
                results.push({
                    videoId,
                    success: false,
                    error: error.message,
                    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
                });
                failedVideoIds.push(videoId);
            }
        }
        
        // 顯示失敗的影片ID以便重試
        if (failedVideoIds.length > 0) {
            console.log(`\n⚠️ 以下 ${failedVideoIds.length} 個影片獲取失敗:`, failedVideoIds);
        }
        
        // 5. 逐一更新每個檔案到Gist（避免 409 衝突）
        console.log(`\n📤 逐一更新 Gist 檔案 (${Object.keys(filesToUpdate).length} 個)...`);
        
        const updateErrors = [];
        let successfulUpdates = 0;
        const fileEntries = Object.entries(filesToUpdate);
        const totalFiles = fileEntries.length;
        
        for (const [fileName, fileContent] of fileEntries) {
            try {
                console.log(`   📝 更新檔案 (${successfulUpdates + 1}/${totalFiles}): ${fileName}`);
                
                const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Vercel-YouTube-Multi-Tracker'
                    },
                    body: JSON.stringify({
                        description: `YouTube 多影片追蹤數據，最後更新: ${new Date().toISOString()}`,
                        files: {
                            [fileName]: fileContent
                        }
                    })
                });
                
                if (!updateResponse.ok) {
                    const errorText = await updateResponse.text();
                    // 409 衝突錯誤的特別處理
                    if (updateResponse.status === 409) {
                        console.warn(`   ⚠️ ${fileName}: 409 衝突，嘗試重新獲取並重試...`);
                        
                        // 重新獲取 Gist 並重試一次
                        const retryResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                            headers: {
                                'Authorization': `token ${GITHUB_TOKEN}`,
                                'User-Agent': 'Vercel-YouTube-Multi-Tracker'
                            }
                        });
                        
                        if (retryResponse.ok) {
                            // 再次嘗試更新
                            const retryUpdateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                                method: 'PATCH',
                                headers: {
                                    'Authorization': `token ${GITHUB_TOKEN}`,
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'Vercel-YouTube-Multi-Tracker'
                                },
                                body: JSON.stringify({
                                    description: `YouTube 多影片追蹤數據，最後更新: ${new Date().toISOString()}`,
                                    files: {
                                        [fileName]: fileContent
                                    }
                                })
                            });
                            
                            if (retryUpdateResponse.ok) {
                                console.log(`   ✅ ${fileName} 重試更新成功`);
                                successfulUpdates++;
                            } else {
                                const retryErrorText = await retryUpdateResponse.text();
                                throw new Error(`${fileName}: ${retryUpdateResponse.status} - ${retryErrorText.substring(0, 100)}`);
                            }
                        } else {
                            throw new Error(`${fileName}: 無法重新獲取 Gist`);
                        }
                    } else {
                        const errorMsg = `${fileName}: ${updateResponse.status} - ${errorText.substring(0, 100)}`;
                        console.error(`   ❌ ${errorMsg}`);
                        updateErrors.push(errorMsg);
                    }
                } else {
                    console.log(`   ✅ ${fileName} 更新成功`);
                    successfulUpdates++;
                }
                
                // 避免觸發 GitHub API rate limit，每次更新後等待 200ms
                if (totalFiles > 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (error) {
                const errorMsg = `${fileName}: ${error.message}`;
                console.error(`   ❌ ${errorMsg}`);
                updateErrors.push(errorMsg);
            }
        }
        
        // 統計更新結果
        console.log(`\n📊 Gist 檔案更新統計:`);
        console.log(`   ✅ 成功: ${successfulUpdates}/${totalFiles}`);
        console.log(`   ❌ 失敗: ${updateErrors.length}`);
        
        if (updateErrors.length > 0) {
            console.error(`\n⚠️ 有 ${updateErrors.length} 個檔案更新失敗:`, updateErrors);
            throw new Error(`部分 Gist 檔案更新失敗: ${updateErrors.join('; ')}`);
        }
        
        console.log(`✅ 所有 Gist 檔案更新成功`);
        
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

// ==================== 【修改】影片管理API處理函數 ====================
async function handleVideoManagement(req, res) {
    console.log(`🔄 處理影片管理: ${req.query.action}`);
    
    // ==================== 【修改】管理操作需要密碼驗證 ====================
    // 對於 verify 動作，使用不同的驗證邏輯
    if (req.query.action === 'verify') {
        return handlePasswordVerification(req, res);
    }
    
    // 對於修改操作（add/delete/update）需要密碼驗證，get 可以公開訪問
    if (['add', 'delete', 'update'].includes(req.query.action)) {
        const providedPassword = req.query.password || req.body?.password;
        const adminPassword = process.env.ADMIN_PASSWORD;
        
        if (!adminPassword) {
            console.error('❌ 管理功能未配置: ADMIN_PASSWORD 環境變數未設置');
            return res.status(500).json({
                success: false,
                error: '管理功能未配置',
                message: '請聯繫管理員設置管理密碼'
            });
        }
        
        if (!providedPassword || providedPassword !== adminPassword) {
            console.error('❌ 無權限訪問管理功能: 密碼錯誤或缺失', {
                hasPassword: !!providedPassword,
                passwordLength: providedPassword ? providedPassword.length : 0,
                expectedLength: adminPassword.length
            });
            return res.status(403).json({
                success: false,
                error: '無權限訪問管理功能',
                message: '需要有效的管理密碼',
                hint: '請在請求中包含正確的密碼參數'
            });
        }
        
        console.log('✅ 管理密碼驗證通過');
    }
    // ==================== 密碼驗證結束 ====================
    
    // 檢查請求方法
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed. Use GET for getting videos, POST for adding/updating/deleting.' 
        });
    }

    // 檢查必要的API密鑰
    if (!GIST_ID || !GITHUB_TOKEN) {
        return res.status(500).json({
            success: false,
            error: '伺服器配置錯誤，缺少Gist設定',
            details: {
                GIST_ID: GIST_ID ? '已設定' : '未設定',
                GITHUB_TOKEN: GITHUB_TOKEN ? '已設定' : '未設定'
            }
        });
    }

    const { action } = req.query;
    let body = req.body || {};

    try {
        // 如果是POST請求且body是字符串，解析為JSON
        if (req.method === 'POST' && typeof body === 'string') {
            body = JSON.parse(body);
        }
    } catch (e) {
        console.error('解析請求體失敗:', e);
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid JSON body',
            receivedBody: typeof req.body === 'string' ? req.body.substring(0, 200) : 'Not a string'
        });
    }

    try {
        console.log(`執行影片管理操作: ${action}`, body);
        
        switch (action) {
            case 'get': {
                // 獲取當前影片列表
                console.log('📋 獲取影片列表...');
                const config = await getUserVideoConfig();
                const videos = Object.values(config.TRACKED_VIDEOS);
                
                console.log(`✅ 返回 ${videos.length} 個影片`);
                return res.status(200).json({
                    success: true,
                    videos: videos,
                    total: videos.length,
                    timestamp: new Date().toISOString()
                });
            }
                
            case 'getTitle': {
                // 獲取影片標題
                console.log('📹 獲取影片標題...');
                const videoId = req.query.videoId;
                
                if (!videoId) {
                    console.error('❌ 缺少影片ID');
                    return res.status(400).json({
                        success: false,
                        error: '影片ID是必需的',
                        hint: '使用 ?videoId=<YouTube影片ID>'
                    });
                }
                
                // 驗證YouTube影片ID格式
                if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
                    console.error('❌ 無效的YouTube影片ID格式:', videoId);
                    return res.status(400).json({
                        success: false,
                        error: '無效的YouTube影片ID格式',
                        hint: 'YouTube影片ID應為11位字符',
                        example: 'dQw4w9WgXcQ',
                        received: videoId
                    });
                }
                
                // 檢查是否配置了YouTube API Key
                if (!YOUTUBE_API_KEY) {
                    console.warn('⚠️ 未配置YouTube API Key，使用標題獲取替代方案');
                    // 嘗試從標題模式中提取標題
                    return res.status(200).json({
                        success: true,
                        title: `影片 ${videoId}`,
                        videoId: videoId,
                        message: '未配置YouTube API，使用預設標題'
                    });
                }
                
                try {
                    // 呼叫YouTube API獲取影片資訊
                    const youtubeUrl = `${YOUTUBE_API_BASE}?id=${videoId}&part=snippet&key=${YOUTUBE_API_KEY}`;
                    console.log(`   🔍 呼叫YouTube API: ${youtubeUrl.substring(0, 80)}...`);
                    
                    const youtubeResponse = await fetch(youtubeUrl);
                    
                    if (!youtubeResponse.ok) {
                        const errorText = await youtubeResponse.text();
                        console.error(`   ❌ YouTube API錯誤 (${videoId}):`, youtubeResponse.status);
                        return res.status(youtubeResponse.status).json({
                            success: false,
                            error: 'YouTube API錯誤',
                            message: `API返回 ${youtubeResponse.status}: ${errorText.substring(0, 100)}`
                        });
                    }
                    
                    const youtubeData = await youtubeResponse.json();
                    
                    if (!youtubeData.items || youtubeData.items.length === 0) {
                        console.error(`   ❌ 影片未找到: ${videoId}`);
                        return res.status(404).json({
                            success: false,
                            error: '影片未找到',
                            message: '該YouTube影片ID可能不存在或已被刪除',
                            videoId: videoId
                        });
                    }
                    
                    const title = youtubeData.items[0].snippet.title;
                    const channelTitle = youtubeData.items[0].snippet.channelTitle;
                    const publishDate = youtubeData.items[0].snippet.publishedAt.split('T')[0];
                    
                    console.log(`   ✅ 獲取成功: "${title}"`);
                    console.log(`   📺 頻道: ${channelTitle}`);
                    console.log(`   📅 發佈日期: ${publishDate}`);
                    
                    return res.status(200).json({
                        success: true,
                        title: title,
                        videoId: videoId,
                        channelTitle: channelTitle,
                        publishDate: publishDate,
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (error) {
                    console.error(`   ❌ 獲取影片標題失敗:`, error.message);
                    return res.status(500).json({
                        success: false,
                        error: '獲取失敗',
                        message: error.message
                    });
                }
            }
                
            case 'add': {
                // 添加新影片
                console.log('➕ 添加新影片...', body);
                const { id, name, description, color } = body;
                
                // 獲取影片發佈日期
                let publishDate = new Date().toISOString().split('T')[0];
                if (YOUTUBE_API_KEY) {
                    try {
                        const youtubeUrl = `${YOUTUBE_API_BASE}?id=${id}&part=snippet&key=${YOUTUBE_API_KEY}`;
                        const response = await fetch(youtubeUrl);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.items && data.items.length > 0) {
                                publishDate = data.items[0].snippet.publishedAt.split('T')[0];
                                console.log(`   📅 獲取到發佈日期: ${publishDate}`);
                            }
                        }
                    } catch (error) {
                        console.log(`   ⚠️ 無法獲取發佈日期: ${error.message}`);
                    }
                }
                
                if (!id || !name) {
                    console.error('❌ 缺少必要參數:', { id, name });
                    return res.status(400).json({
                        success: false,
                        error: '影片ID和名稱是必需的',
                        received: { id, name }
                    });
                }
                
                // 驗證YouTube影片ID格式
                if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
                    console.error('❌ 無效的YouTube影片ID格式:', id);
                    return res.status(400).json({
                        success: false,
                        error: '無效的YouTube影片ID格式。應為11位字符',
                        example: 'dQw4w9WgXcQ',
                        received: id
                    });
                }
                
                // 獲取當前配置
                console.log('📥 獲取當前配置...');
                const config = await getUserVideoConfig();
                let videoList = Object.values(config.TRACKED_VIDEOS);
                
                console.log(`📊 當前有 ${videoList.length} 個影片`);
                
                // 檢查重複
                if (videoList.some(v => v.id === id)) {
                    console.error('❌ 影片ID已存在:', id);
                    return res.status(400).json({
                        success: false,
                        error: '影片ID已存在',
                        existingVideos: videoList.map(v => v.id)
                    });
                }
                
                // 添加新影片
                const newVideo = {
                    id,
                    name,
                    description: description || `${name} - YouTube影片播放量追蹤`,
                    color: color || '#0070f3',
                    startDate: new Date().toISOString().split('T')[0],
                    publishDate: publishDate
                };
                
                videoList.push(newVideo);
                
                console.log(`💾 儲存配置，共 ${videoList.length} 個影片...`);
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    console.error('❌ 儲存配置失敗');
                    return res.status(500).json({
                        success: false,
                        error: '儲存配置失敗，請檢查Gist設定'
                    });
                }
                
                console.log(`✅ 影片添加成功: ${name} (${id})`);
                
                return res.status(200).json({
                    success: true,
                    message: '影片添加成功',
                    video: newVideo,
                    total: videoList.length,
                    timestamp: new Date().toISOString()
                });
            }
                
            case 'delete': {
                // 刪除影片
                console.log('🗑️ 刪除影片...', body);
                const { id } = body;
                
                if (!id) {
                    console.error('❌ 缺少影片ID');
                    return res.status(400).json({
                        success: false,
                        error: '影片ID是必需的'
                    });
                }
                
                // 獲取當前配置
                console.log('📥 獲取當前配置...');
                const config = await getUserVideoConfig();
                let videoList = Object.values(config.TRACKED_VIDEOS);
                
                console.log(`📊 當前有 ${videoList.length} 個影片`);
                
                // 檢查是否可以刪除（至少保留一個影片）
                if (videoList.length <= 1) {
                    console.error('❌ 無法刪除：至少需要保留一個追蹤影片');
                    return res.status(400).json({
                        success: false,
                        error: '至少需要保留一個追蹤影片',
                        currentCount: videoList.length
                    });
                }
                
                // 查找影片
                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    console.error('❌ 影片未找到:', id);
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到',
                        availableVideos: videoList.map(v => v.id)
                    });
                }
                
                const deletedVideo = videoList[index];
                videoList.splice(index, 1);
                
                console.log(`💾 儲存配置，刪除後剩餘 ${videoList.length} 個影片...`);
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    console.error('❌ 刪除配置失敗');
                    return res.status(500).json({
                        success: false,
                        error: '刪除配置失敗，請檢查Gist設定'
                    });
                }
                
                console.log(`✅ 影片刪除成功: ${deletedVideo.name} (${id})`);
                
                return res.status(200).json({
                    success: true,
                    message: '影片刪除成功',
                    deletedVideo,
                    total: videoList.length,
                    timestamp: new Date().toISOString()
                });
            }
                
            case 'quota': {
                // 獲取配額狀態
                console.log('📊 獲取配額狀態...');
                const quotaStatus = await getQuotaStatus();
                
                console.log(`✅ 返回配額狀態: 使用 ${quotaStatus.usage}/${quotaStatus.limit}`);
                return res.status(200).json({
                    success: true,
                    quota: quotaStatus,
                    timestamp: new Date().toISOString()
                });
            }
                
            case 'update': {
                // 更新影片
                console.log('✏️ 更新影片...', body);
                const { id, name, description, color } = body;
                
                if (!id) {
                    console.error('❌ 缺少影片ID');
                    return res.status(400).json({
                        success: false,
                        error: '影片ID是必需的'
                    });
                }
                
                // 獲取當前配置
                console.log('📥 獲取當前配置...');
                const config = await getUserVideoConfig();
                let videoList = Object.values(config.TRACKED_VIDEOS);
                
                // 找到並更新影片
                const index = videoList.findIndex(v => v.id === id);
                if (index === -1) {
                    console.error('❌ 影片未找到:', id);
                    return res.status(404).json({
                        success: false,
                        error: '影片未找到',
                        availableVideos: videoList.map(v => v.id)
                    });
                }
                
                // 記錄原始信息
                const originalVideo = { ...videoList[index] };
                
                if (name) videoList[index].name = name;
                if (description !== undefined) videoList[index].description = description;
                if (color) videoList[index].color = color;
                
                console.log(`💾 儲存配置，更新影片: ${originalVideo.name} → ${videoList[index].name}...`);
                
                // 儲存配置
                const saveResult = await saveUserVideoConfig(videoList);
                
                if (!saveResult) {
                    console.error('❌ 更新配置失敗');
                    return res.status(500).json({
                        success: false,
                        error: '更新配置失敗，請檢查Gist設定'
                    });
                }
                
                console.log(`✅ 影片更新成功: ${originalVideo.name} (${id})`);
                
                return res.status(200).json({
                    success: true,
                    message: '影片更新成功',
                    original: originalVideo,
                    updated: videoList[index],
                    total: videoList.length,
                    timestamp: new Date().toISOString()
                });
            }
                
            default:
                console.error('❌ 未知的操作類型:', action);
                return res.status(400).json({
                    success: false,
                    error: '未知的操作類型',
                    allowedActions: ['get', 'add', 'delete', 'update', 'verify', 'getTitle'],
                    received: action
                });
        }
    } catch (error) {
        console.error('❌ 影片管理操作失敗:', error);
        return res.status(500).json({
            success: false,
            error: '內部伺服器錯誤',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== 【新增】密碼驗證處理函數 ====================
async function handlePasswordVerification(req, res) {
    console.log('🔐 處理密碼驗證請求');
    
    // 檢查請求方法
    if (req.method !== 'POST') {
        console.error('❌ 密碼驗證需要POST方法');
        return res.status(405).json({
            success: false,
            error: 'Method not allowed',
            message: '密碼驗證需要使用POST方法'
        });
    }
    
    let body;
    try {
        // 解析請求體
        if (typeof req.body === 'string') {
            body = JSON.parse(req.body);
        } else {
            body = req.body || {};
        }
    } catch (e) {
        console.error('❌ 解析請求體失敗:', e);
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON body',
            message: '無法解析請求體'
        });
    }
    
    const { password } = body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    console.log('🔍 驗證密碼:', {
        hasPassword: !!password,
        passwordLength: password ? password.length : 0,
        hasAdminPassword: !!adminPassword,
        adminPasswordLength: adminPassword ? adminPassword.length : 0
    });
    
    // 檢查管理密碼是否配置
    if (!adminPassword) {
        console.error('❌ 管理密碼未配置');
        return res.status(500).json({
            success: false,
            error: '管理功能未配置',
            message: '請聯繫管理員設置管理密碼'
        });
    }
    
    // 檢查是否提供了密碼
    if (!password) {
        console.error('❌ 未提供密碼');
        return res.status(400).json({
            success: false,
            error: '密碼是必需的',
            message: '請提供密碼'
        });
    }
    
    // 驗證密碼
    const isValid = password === adminPassword;
    
    console.log(`🔐 密碼驗證結果: ${isValid ? '✅ 成功' : '❌ 失敗'}`);
    
    if (isValid) {
        return res.status(200).json({
            success: true,
            message: '密碼驗證成功',
            timestamp: new Date().toISOString()
        });
    } else {
        return res.status(403).json({
            success: false,
            error: '密碼錯誤',
            message: '提供的密碼不正確',
            timestamp: new Date().toISOString()
        });
    }
}

export const config = {
    runtime: 'nodejs',
};
