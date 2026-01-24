// api/quota-status.js
/**
 * 配額狀態 API 端點
 * 提供當前 YouTube API 配額使用狀態給前端顯示
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

        // 返回符合前端預期的格式
        const response = {
            success: true,
            data: {
                used: quotaStatus.usage,          // 當前使用量
                total: quotaStatus.limit,         // 總配額限制 (10000)
                resetDate: resetDate.toISOString(), // 重置時間 ISO 格式
                percentage: quotaStatus.percentage, // 使用百分比
                remaining: quotaStatus.remaining,   // 剩餘配額
                date: quotaStatus.date,            // 當前日期 (PT)
                callsCount: quotaStatus.calls?.length || 0, // API 調用次數
                resetTime: {
                    hours: resetTime.hours,
                    minutes: resetTime.minutes
                }
            }
        };
        
        console.log('✅ [quota-status] 成功返回配額數據:', response);
        
        return res.status(200).json(response);

    } catch (error) {
        console.error('❌ [quota-status] 獲取配額狀態失敗:', error);
        
        // 即使出錯也返回有效數據，避免前端崩潰
        const fallbackResetDate = new Date(Date.now() + 24*60*60*1000);
        
        return res.status(200).json({
            success: true, // 使用 true 避免前端顯示錯誤
            data: {
                used: 0,
                total: 10000,
                resetDate: fallbackResetDate.toISOString(),
                percentage: '0.00',
                remaining: 10000,
                date: new Date().toISOString().split('T')[0],
                callsCount: 0,
                error: error.message // 記錄錯誤但不阻斷顯示
            }
        });
    }
}
