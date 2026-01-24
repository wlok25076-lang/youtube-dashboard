// api/quota-status.js
import { getQuotaStatus } from './quota-manager.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method Not Allowed' 
        });
    }

    try {
        const quotaStatus = await getQuotaStatus();
        const resetTime = quotaStatus.resetTime;
        const resetDate = new Date(Date.now() + resetTime.totalMilliseconds);

        return res.status(200).json({
            success: true,
            quota: {
                date: quotaStatus.date,
                usage: quotaStatus.usage,
                limit: quotaStatus.limit,
                percentage: quotaStatus.percentage,
                remaining: quotaStatus.remaining,
                calls: quotaStatus.calls || [],
                resetDate: resetDate.toISOString()
            }
        });

    } catch (error) {
        console.error('❌ [quota-status] 錯誤:', error);
        
        return res.status(200).json({
            success: true,
            quota: {
                date: new Date().toISOString().split('T'),
                usage: 0,
                limit: 10000,
                percentage: '0.00',
                remaining: 10000,
                calls: [],
                resetDate: new Date(Date.now() + 24*60*60*1000).toISOString()
            }
        });
    }
}
