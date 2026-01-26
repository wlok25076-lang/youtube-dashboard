/**
 * env.js - 環境變數檢查工具
 * 供 Vercel Serverless Functions 使用
 */

/**
 * 檢查必要的環境變數
 * @param {string[]} keys - 需要檢查的環境變數名稱陣列
 * @returns {{ ok: true, values: Record<string, string> } | { ok: false, missing: string[] }}
 */
export function requireEnv(keys) {
    const missing = [];
    
    for (const key of keys) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }
    
    if (missing.length > 0) {
        return { ok: false, missing };
    }
    
    // 只回傳需要的變數值，不 log
    const values = {};
    for (const key of keys) {
        values[key] = process.env[key];
    }
    
    return { ok: true, values };
}

/**
 * 發送環境變數缺失錯誤
 * @param {Response} res - Vercel Response 物件
 * @param {string[]} missing - 缺失的環境變數列表
 * @param {object} [extra={}] - 額外的錯誤資訊
 */
export function sendEnvError(res, missing, extra = {}) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    
    res.json({
        ok: false,
        error: {
            code: "MISSING_ENV",
            message: "Missing required environment variables",
            missing
        },
        ...extra
    });
}

/**
 * 發送 JSON 回應
 * @param {Response} res - Vercel Response 物件
 * @param {number} status - HTTP 狀態碼
 * @param {object} data - 要回傳的資料
 */
export function sendJson(res, status, data) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json(data);
}
