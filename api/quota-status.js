// api/quota-status.js
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
        // 從 quota-manager 獲取配額狀態
        const quotaStatus = await getQuotaStatus();
        
        // 計算重置時間（PT午夜 = UTC+8 16:00）
        const resetTime = quotaStatus.resetTime;
        const now = new Date();
        const resetDate = new Date(now.getTime() + resetTime.totalMilliseconds);

        // 返回符合前端預期的格式
        return res.status(200).json({
            success: true,
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

    } catch (error) {
        console.error('❌ 獲取配額狀態失敗:', error);
        
        return res.status(500).json({
            success: false,
            error: error.message || '獲取配額狀態失敗',
            // 提供默認值避免前端崩潰
            data: {
                used: 0,
                total: 10000,
                resetDate: new Date(Date.now() + 24*60*60*1000).toISOString()
            }
        });
    }
}
