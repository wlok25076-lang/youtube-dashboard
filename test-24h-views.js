/**
 * test-24h-views.js
 * 測試最近24小時播放量計算功能
 */

// 使用固定時間戳進行測試
const FIXED_NOW = 1704067200000; // 2024-01-01 00:00:00 UTC

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
    }
};

// 計算最近24小時播放量的函數（從 chart-data.js 複製過來）
function computeViewsLast24h(data, now = Date.now()) {
    const NOW = now;
    const MS_24H = 24 * 60 * 60 * 1000;
    const BOUNDARY_24H_AGO = NOW - MS_24H;
    
    let snapshots = [];
    
    if (Array.isArray(data)) {
        snapshots = data.map(item => ({
            ts: item.timestamp || item.ts,
            views_total: item.viewCount || item.views_total || 0
        }));
    } else if (data && Array.isArray(data.snapshots)) {
        snapshots = data.snapshots.map(item => ({
            ts: item.ts || item.timestamp,
            views_total: item.views_total || item.viewCount || 0
        }));
    } else if (data && Array.isArray(data.raw)) {
        snapshots = data.raw.map(item => ({
            ts: item.timestamp || item.ts,
            views_total: item.viewCount || item.views_total || 0
        }));
    } else {
        console.warn('⚠️ [24h] 無法識別的數據格式');
        return { views: null, reason: 'invalid_format' };
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
        base: base,
        window: {
            start: new Date(base.ts).toISOString(),
            end: new Date(current.ts).toISOString()
        }
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
    
    console.log('\n' + '='.repeat(50));
    console.log(`📈 測試結果: ${passed} 通過, ${failed} 失敗`);
    console.log('='.repeat(50));
    
    return { passed, failed };
}

// 運行測試
runTests();
