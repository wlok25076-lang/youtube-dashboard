// api/quota-status.js
/**
 * 配額狀態 API 端點
 * 提供當前 YouTube API 配額使用狀態給前端顯示
 * 返回格式與 fetch-and-store-multi.js?action=quota 保持一致
 */

import { getQuotaStatus } from './quota-manager.js';

export default async function handler(req, res) {
    // 只允許 GET 請求
    if (req.method !== 'GET') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method Not Allowed' 
        });
    }

    try {
        console.log('📊 [quota-status] 開始獲取配額狀態...');
        
        // 從 quota-manager 獲取配額狀態
        const quotaStatus = await getQuotaStatus();
        
        console.log('📊 [quota-status] Gist 配額數據:', {
            date: quotaStatus.date,
            usage: quotaStatus.usage,
            limit: quotaStatus.limit,
            callsCount: quotaStatus.calls?.length || 0
        });
        
        // 計算重置時間（PT午夜）
        const resetTime = quotaStatus.resetTime;
        const now = new Date();
        const resetDate = new Date(now.getTime() + resetTime.totalMilliseconds);

        // 【修改】返回與 fetch-and-store-multi.js 相同的格式
        const response = {
            success: true,
<<<<<<< HEAD
            quota: {
                usage: quotaStatus.usage,
                limit: quotaStatus.limit,
                resetDate: resetDate.toISOString(),
                percentage: quotaStatus.percentage,
                remaining: quotaStatus.remaining,
                date: quotaStatus.date,
                callsCount: quotaStatus.calls?.length || 0
            }
        });
=======
            quota: {                              // 使用 quota 而非 data
                date: quotaStatus.date,           // 當前日期 (PT)
                usage: quotaStatus.usage,         // 當前使用量 (匹配 fetch-and-store-multi.js)
                limit: quotaStatus.limit,         // 總配額限制 (10000)
                percentage: quotaStatus.percentage, // 使用百分比
                remaining: quotaStatus.remaining,   // 剩餘配額
                calls: quotaStatus.calls || [],     // API 調用記錄
                resetDate: resetDate.toISOString(), // 重置時間 ISO 格式
                resetTime: {
                    hours: resetTime.hours,
                    minutes: resetTime.minutes
                }
            },
            timestamp: new Date().toISOString()
        };
        
        console.log('✅ [quota-status] 成功返回配額數據:', response);
        
        return res.status(200).json(response);
>>>>>>> 0047a45b66f457a4a1185af360bcf558b96e1261

    } catch (error) {
        console.error('❌ [quota-status] 獲取配額狀態失敗:', error);
        
        // 即使出錯也返回有效數據，避免前端崩潰
        const fallbackResetDate = new Date(Date.now() + 24*60*60*1000);
        
        return res.status(200).json({
            success: true, // 使用 true 避免前端顯示錯誤
            quota: {
                date: new Date().toISOString().split('T')[0],
                usage: 0,
                limit: 10000,
                percentage: '0.00',
                remaining: 10000,
                calls: [],
                resetDate: fallbackResetDate.toISOString(),
                error: error.message // 記錄錯誤但不阻斷顯示
            },
            timestamp: new Date().toISOString()
        });
    }
}
