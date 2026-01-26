/**
 * test-24h-views.js
 * 測試最近24小時播放量計算功能與 normalizeTs helper
 */

// 使用固定時間戳進行測試
const FIXED_NOW = 1704067200000; // 2024-01-01 00:00:00 UTC
const MS_24H = 24 * 60 * 60 * 1000; // 全域常量

// 模擬的測試數據
const testData = {
    // 測試案例1: 正常的24小時數據
    case1: {
        snapshots: [
            { ts: FIXED_NOW - 48 * 60 * 60 * 1000, views_total: 1000 }, // 48小時前
            { ts: FIXED_NOW - 24 * 60 * 60 * 1000, views_total: 1200 }, // 24小時前
            { ts: FIXED_NOW - 12 * 60 * 60 * 1000, views_total: 1400 }, // 12小時前
            { ts: FIXED_NOW, views_total: 1700 } // 現在
        ],
        expected: 500 // 1700 - 1200 = 500
    },
    
    // 測試案例2: 只有2筆數據，但夠24小時
    case2: {
        snapshots: [
            { ts: FIXED_NOW - 24 * 60 * 60 * 1000, views_total: 1200 },
            { ts: FIXED_NOW, views_total: 1700 }
        ],
        expected: 500
    },
    
    // 測試案例3: 舊版格式（使用 timestamp 和 viewCount）
    case3: {
        raw: [
            { timestamp: FIXED_NOW - 48 * 60 * 60 * 1000, viewCount: 1000 },
            { timestamp: FIXED_NOW - 24 * 60 * 60 * 1000, viewCount: 1200 },
            { timestamp: FIXED_NOW, viewCount: 1700 }
        ],
        expected: 500
    },
    
    // 測試案例4: 數據不足（只有1筆）
    case4: {
        snapshots: [
            { ts: FIXED_NOW, views_total: 1700 }
        ],
        expected: null // 應該返回 null（數據不足）
    },
    
    // 測試案例5: 沒有 >= 24小時前的數據（使用 fallback）
    case5: {
        snapshots: [
            { ts: FIXED_NOW - 12 * 60 * 60 * 1000, views_total: 1400 },
            { ts: FIXED_NOW, views_total: 1700 }
        ],
        expected: 300 // 使用最早的數據 1400，1700 - 1400 = 300
    },
    
    // 測試案例6: ISO string 時間戳
    case6: {
        snapshots: [
            { ts: '2023-12-31T12:00:00.000Z', views_total: 1000 }, // ISO string
            { ts: FIXED_NOW - 24 * 60 * 60 * 1000, views_total: 1200 }, // number
            { ts: FIXED_NOW, views_total: 1700 }
        ],
        expected: 500
    },
    
    // 測試案例7: 混合時間戳格式
    case7: {
        snapshots: [
            { ts: FIXED_NOW - 48 * 60 * 60 * 1000, views_total: 1000 }, // number
            { ts: '2024-01-01T00:00:00.000Z', views_total: 1700 } // ISO string
        ],
        expected: 700 // 1700 - 1000 = 700
    },
    
    // 測試案例8: 無效時間戳應該被跳過
    case8: {
        snapshots: [
            { ts: 'invalid-iso-string', views_total: 1000 }, // 無效
            { ts: null, views_total: 1100 }, // null
            { ts: FIXED_NOW - 24 * 60 * 60 * 1000, views_total: 1200 },
            { ts: FIXED_NOW, views_total: 1700 }
        ],
        expected: 500 // 應該忽略前兩筆無效數據
    }
};

// 【新增】時間戳正規化 helper（從 chart-data.js 複製）
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

// 計算最近24小時播放量的函數（從 chart-data.js 複製過來）
function computeViewsLast24h(data, now = Date.now()) {
    const NOW = now;
    const BOUNDARY_24H_AGO = NOW - MS_24H;
    
    let snapshots = [];
    
    if (Array.isArray(data)) {
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
        console.warn('⚠️ [24h] 無法識別的數據格式');
        return { views: null, reason: 'invalid_format' };
    }
    
    if (snapshots.length === 0) {
        console.warn('⚠️ [24h] 沒有有效的數據記錄');
        return { views: null, reason: 'no_valid_data' };
    }
    
    snapshots.sort((a, b) => a.ts - b.ts);
    
    if (snapshots.length < 2) {
        console.warn('⚠️ [24h] 數據不足，只有', snapshots.length, '筆');
        return { views: null, reason: 'insufficient_data', count: snapshots.length };
    }
    
    let current = null;
    for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].ts <= NOW) {
            current = snapshots[i];
            break;
        }
    }
    
    if (!current) {
        current = snapshots[snapshots.length - 1];
    }
    
    let base = null;
    let baseDiff = Infinity;
    
    for (const snapshot of snapshots) {
        if (snapshot.ts >= BOUNDARY_24H_AGO) {
            const diff = Math.abs(snapshot.ts - BOUNDARY_24H_AGO);
            if (diff < baseDiff) {
                baseDiff = diff;
                base = snapshot;
            }
        }
    }
    
    if (!base) {
        const earliest = snapshots[0];
        if (NOW - earliest.ts <= 48 * 60 * 60 * 1000) {
            base = earliest;
        } else {
            console.warn('⚠️ [24h] 沒有足夠早的數據，無法計算 24h');
            return { views: null, reason: 'no_data_24h_ago' };
        }
    }
    
    const views = Math.max(0, current.views_total - base.views_total);
    
    return {
        views: views,
        current: current,
        base: base
    };
}

// 【新增】computeTodayGrowth 函數測試
function computeTodayGrowth(data, now = Date.now()) {
    const NOW = now;
    
    // 香港時間的今天開始（00:00 HKT）
    const hkNow = new Date(NOW + (8 * 3600000));
    const hkTodayStart = new Date(hkNow.getFullYear(), hkNow.getMonth(), hkToday.getDate());
    const hkTodayStartUTC = hkTodayStart.getTime() - (8 * 3600000);
    const hkTodayEndUTC = hkTodayStartUTC + MS_24H;
    
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
    
    snapshots.sort((a, b) => a.ts - b.ts);
    
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

// 運行測試
function runTests() {
    console.log('🧪 開始測試最近24小時播放量計算...\n');
    console.log('📅 測試固定時間戳:', new Date(FIXED_NOW).toISOString(), '\n');
    
    let passed = 0;
    let failed = 0;
    
    // 測試案例1
    console.log('📊 測試案例1: 正常24小時數據（4筆）');
    const result1 = computeViewsLast24h(testData.case1.snapshots, FIXED_NOW);
    if (result1.views === testData.case1.expected) {
        console.log('✅ 通過: 計算結果', result1.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case1.expected, '實際', result1.views);
        failed++;
    }
    
    // 測試案例2
    console.log('\n📊 測試案例2: 只有2筆數據');
    const result2 = computeViewsLast24h(testData.case2.snapshots, FIXED_NOW);
    if (result2.views === testData.case2.expected) {
        console.log('✅ 通過: 計算結果', result2.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case2.expected, '實際', result2.views);
        failed++;
    }
    
    // 測試案例3（舊版格式）
    console.log('\n📊 測試案例3: 舊版數據格式');
    const result3 = computeViewsLast24h(testData.case3.raw, FIXED_NOW);
    if (result3.views === testData.case3.expected) {
        console.log('✅ 通過: 計算結果', result3.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case3.expected, '實際', result3.views);
        failed++;
    }
    
    // 測試案例4（數據不足）
    console.log('\n📊 測試案例4: 數據不足（只有1筆）');
    const result4 = computeViewsLast24h(testData.case4.snapshots, FIXED_NOW);
    if (result4.views === testData.case4.expected) {
        console.log('✅ 通過: 正確返回 null');
        passed++;
    } else {
        console.log('❌ 失敗: 預期 null，實際', result4.views);
        failed++;
    }
    
    // 測試案例5（沒有 >= 24小時前的數據，使用 fallback）
    console.log('\n📊 測試案例5: 沒有 >= 24小時前的數據（fallback）');
    const result5 = computeViewsLast24h(testData.case5.snapshots, FIXED_NOW);
    if (result5.views === testData.case5.expected) {
        console.log('✅ 通過: 計算結果', result5.views, '(使用 fallback)');
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case5.expected, '實際', result5.views);
        failed++;
    }
    
    // 測試案例6（ISO string 時間戳）
    console.log('\n📊 測試案例6: ISO string 時間戳');
    const result6 = computeViewsLast24h(testData.case6.snapshots, FIXED_NOW);
    if (result6.views === testData.case6.expected) {
        console.log('✅ 通過: ISO string 轉換正確，計算結果', result6.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case6.expected, '實際', result6.views);
        failed++;
    }
    
    // 測試案例7（混合時間戳格式）
    console.log('\n📊 測試案例7: 混合時間戳格式');
    const result7 = computeViewsLast24h(testData.case7.snapshots, FIXED_NOW);
    if (result7.views === testData.case7.expected) {
        console.log('✅ 通過: 混合格式處理正確，計算結果', result7.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case7.expected, '實際', result7.views);
        failed++;
    }
    
    // 測試案例8（無效時間戳應該被跳過）
    console.log('\n📊 測試案例8: 無效時間戳應被跳過');
    const result8 = computeViewsLast24h(testData.case8.snapshots, FIXED_NOW);
    if (result8.views === testData.case8.expected && result8.views !== null && !isNaN(result8.views)) {
        console.log('✅ 通過: 無效時間戳已跳過，計算結果', result8.views);
        passed++;
    } else {
        console.log('❌ 失敗: 預期', testData.case8.expected, '實際', result8.views);
        failed++;
    }
    
    // ========== 新增測試：normalizeTs ==========
    console.log('\n' + '='.repeat(50));
    console.log('🧪 normalizeTs 測試');
    console.log('='.repeat(50));
    
    const normalizeTests = [
        { input: 1704067200000, expected: 1704067200000, desc: 'number' },
        { input: '2024-01-01T00:00:00.000Z', expected: 1704067200000, desc: 'ISO string' },
        { input: '2024-01-01T00:00:00Z', expected: 1704067200000, desc: 'ISO string (no ms)' },
        { input: null, expected: null, desc: 'null' },
        { input: undefined, expected: null, desc: 'undefined' },
        { input: 'invalid', expected: null, desc: 'invalid string' },
        { input: '', expected: null, desc: 'empty string' }
    ];
    
    for (const test of normalizeTests) {
        const result = normalizeTs(test.input);
        if (result === test.expected) {
            console.log(`✅ normalizeTs(${test.desc}): ${result}`);
            passed++;
        } else {
            console.log(`❌ normalizeTs(${test.desc}): 預期 ${test.expected}，實際 ${result}`);
            failed++;
        }
    }
    
    // ========== 新增測試：computeTodayGrowth 不再 ReferenceError ==========
    console.log('\n' + '='.repeat(50));
    console.log('🧪 computeTodayGrowth 測試（驗證 MS_24H 已定義）');
    console.log('='.repeat(50));
    
    // 測試數據：今日香港時區的數據
    const hkNow = new Date(FIXED_NOW + (8 * 3600000));
    const hkTodayStart = new Date(hkNow.getFullYear(), hkNow.getMonth(), hkToday.getDate());
    const hkTodayStartUTC = hkTodayStart.getTime() - (8 * 3600000);
    
    const todayGrowthData = [
        { ts: hkTodayStartUTC, views_total: 1000 }, // 今天開始
        { ts: hkTodayStartUTC + 6 * 60 * 60 * 1000, views_total: 1100 }, // 6小時後
        { ts: hkTodayStartUTC + 12 * 60 * 60 * 1000, views_total: 1300 } // 12小時後
    ];
    
    try {
        const todayGrowthResult = computeTodayGrowth(todayGrowthData, FIXED_NOW);
        if (todayGrowthResult.growth === 300) {
            console.log('✅ computeTodayGrowth: 計算正確，增長', todayGrowthResult.growth);
            passed++;
        } else {
            console.log('❌ computeTodayGrowth: 預期 300，實際', todayGrowthResult.growth);
            failed++;
        }
    } catch (error) {
        console.log('❌ computeTodayGrowth: 發生錯誤 -', error.message);
        failed++;
    }
    
    // 測試 ISO string 在 computeTodayGrowth
    console.log('\n📊 computeTodayGrowth 測試：ISO string 時間戳');
    const todayGrowthDataISO = [
        { ts: new Date(hkTodayStartUTC).toISOString(), views_total: 1000 }, // ISO string
        { ts: new Date(hkTodayStartUTC + 12 * 60 * 60 * 1000).toISOString(), views_total: 1300 }
    ];
    
    try {
        const todayGrowthResultISO = computeTodayGrowth(todayGrowthDataISO, FIXED_NOW);
        if (todayGrowthResultISO.growth === 300) {
            console.log('✅ computeTodayGrowth + ISO string: 計算正確，增長', todayGrowthResultISO.growth);
            passed++;
        } else {
            console.log('❌ computeTodayGrowth + ISO string: 預期 300，實際', todayGrowthResultISO.growth);
            failed++;
        }
    } catch (error) {
        console.log('❌ computeTodayGrowth + ISO string: 發生錯誤 -', error.message);
        failed++;
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`📈 測試結果: ${passed} 通過, ${failed} 失敗`);
    console.log('='.repeat(50));
    
    return { passed, failed };
}

// 運行測試
runTests();
