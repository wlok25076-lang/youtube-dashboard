/**
 * YouTube API Quota Display Component
 * 配額顯示元件 - 可獨立使用或嵌入現有頁面
 */

class QuotaDisplay {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            apiEndpoint: options.apiEndpoint || '/api/fetch-and-store-multi?action=quota',
            refreshInterval: options.refreshInterval || 60000, // 60秒
            showApiCosts: options.showApiCosts !== false,
            onStatusChange: options.onStatusChange || null
        };
        
        this.quota = {
            usage: 0,
            limit: 10000,
            percentage: 0,
            resetTime: { hours: 0, minutes: 0 }
        };
        
        this.intervalId = null;
        this.isLoading = false;
        
        if (this.container) {
            this.init();
        }
    }
    
    async init() {
        this.renderLoading();
        await this.fetchQuota();
        this.render();
        this.startAutoRefresh();
        
        // 監聽影片切換時更新顏色
        this.setupColorThemeListener();
    }
    
    async fetchQuota() {
        // 【修改】支持緊湊模式使用不同的 API endpoint
        const endpoint = this.container.id === 'quotaCompactDisplay' 
            ? '/api/quota-status' 
            : this.options.apiEndpoint;
        
        try {
            const response = await fetch(endpoint);
            
            if (!response.ok) {
                console.error('配額API返回錯誤:', response.status);
                // 使用默認值
                this.quota = {
                    usage: 0,
                    limit: 10000,
                    percentage: 0,
                    resetTime: { hours: 24, minutes: 0 }
                };
                return true;
            }
            
            const data = await response.json();
            
            // 處理新格式 /api/quota-status 返回
            if (data.success && data.data) {
                const quota = data.data;
                const percentage = Math.round((quota.used / quota.total) * 100);
                const resetDate = new Date(quota.resetDate);
                const now = new Date();
                
                // 計算距離重置的時間
                const diffMs = resetDate - now;
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                
                this.quota = {
                    usage: quota.used || 0,
                    limit: quota.total || 10000,
                    percentage: percentage,
                    resetTime: { hours: Math.max(0, diffHours), minutes: Math.max(0, diffMinutes) },
                    date: quota.resetDate
                };
                
                if (this.options.onStatusChange) {
                    this.options.onStatusChange(this.quota);
                }
                
                return true;
            }
            
            // 處理舊格式
            if (data.success && data.quota) {
                this.quota = {
                    usage: data.quota.usage || 0,
                    limit: data.quota.limit || 10000,
                    percentage: parseFloat(data.quota.percentage) || 0,
                    resetTime: data.quota.resetTime || { hours: 0, minutes: 0 },
                    date: data.quota.date
                };
                
                if (this.options.onStatusChange) {
                    this.options.onStatusChange(this.quota);
                }
                
                return true;
            }
            
            // API 返回 success: false 或其他情況，使用默認值
            console.warn('配額API返回異常數據，使用默認值');
            this.quota = {
                usage: 0,
                limit: 10000,
                percentage: 0,
                resetTime: { hours: 24, minutes: 0 }
            };
            return true;
        } catch (error) {
            console.error('獲取配額狀態失敗:', error);
            // 使用默認值，不返回 false 以避免顯示錯誤
            this.quota = {
                usage: 0,
                limit: 10000,
                percentage: 0,
                resetTime: { hours: 24, minutes: 0 }
            };
            return true;
        }
    }
    
    renderLoading() {
        this.container.innerHTML = `
            <div class="quota-display-loading">
                <span class="quota-spinner"></span>
                <span>載入配額狀態...</span>
            </div>
        `;
    }
    
    render() {
        // 【新增】檢查是否為緊湊顯示模式
        if (this.container.id === 'quotaCompactDisplay') {
            return this.renderCompact();
        }
        
        const { usage, limit, percentage, resetTime } = this.quota;
        
        // 計算狀態
        const isWarning = percentage >= 80;
        const isDanger = percentage >= 95;
        const progressColor = isDanger ? 'quota-danger' : isWarning ? 'quota-warning' : 'quota-normal';
        const textColor = isDanger ? 'quota-text-danger' : isWarning ? 'quota-text-warning' : 'quota-text-normal';
        const statusMessage = isDanger 
            ? '🚨 配額嚴重不足，建議停止查詢' 
            : isWarning 
                ? '⚠️ 配額即將用盡，請謹慎使用' 
                : '';
        
        // 格式化時間
        const resetTimeText = resetTime.hours > 0 
            ? `${resetTime.hours} 小時 ${resetTime.minutes} 分鐘`
            : `${resetTime.minutes} 分鐘`;
        
        this.container.innerHTML = `
            <div class="quota-card ${progressColor}">
                <div class="quota-header">
                    <div class="quota-title">
                        <svg class="quota-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                        </svg>
                        YouTube API 配額使用量
                    </div>
                    <button class="quota-refresh-btn" onclick="window.quotaDisplay?.refresh()" title="刷新">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M23 4v6h-6"/>
                            <path d="M1 20v-6h6"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    </button>
                </div>
                
                ${statusMessage ? `<div class="quota-alert ${progressColor}">${statusMessage}</div>` : ''}
                
                <div class="quota-usage">
                    <span class="quota-usage-value ${textColor}">${usage.toLocaleString()}</span>
                    <span class="quota-usage-limit">/ ${limit.toLocaleString()} units</span>
                    <span class="quota-percentage">(${percentage.toFixed(2)}%)</span>
                </div>
                
                <div class="quota-progress-container">
                    <div class="quota-progress-bar">
                        <div class="quota-progress-fill ${progressColor}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <div class="quota-progress-labels">
                        <span>0</span>
                        <span>${(limit / 4).toLocaleString()}</span>
                        <span>${(limit / 2).toLocaleString()}</span>
                        <span>${(limit * 0.75).toLocaleString()}</span>
                        <span>${limit.toLocaleString()}</span>
                    </div>
                </div>
                
                <div class="quota-reset-timer">
                    <div class="quota-timer-label">配額將在</div>
                    <div class="quota-timer-value">${resetTimeText}</div>
                    <div class="quota-timer-label">後重置（PT 時區）</div>
                </div>
                
                ${this.options.showApiCosts ? `
                <div class="quota-api-costs">
                    <div class="quota-costs-title">常見 API 成本</div>
                    <div class="quota-cost-item">
                        <span>videos.list</span>
                        <span class="quota-cost-badge">1 unit</span>
                    </div>
                    <div class="quota-cost-item">
                        <span>search.list</span>
                        <span class="quota-cost-badge">100 units</span>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    // 【新增】緊湊模式渲染
    renderCompact() {
        const { usage, limit, percentage, resetTime } = this.quota;
        
        // 【新增】確保 resetTime 有效
        const safeResetTime = resetTime || { hours: 0, minutes: 0 };
        
        // 格式化時間
        const resetTimeText = safeResetTime.hours > 0 
            ? `${safeResetTime.hours} 小時 ${safeResetTime.minutes} 分鐘`
            : `${safeResetTime.minutes} 分鐘`;
        
        // 計算狀態顏色
        const isDanger = percentage >= 95;
        const isWarning = percentage >= 80;
        const valueColor = isDanger ? '#ef4444' : isWarning ? '#f59e0b' : '#0070f3';
        
        this.container.innerHTML = `
            <div class="quota-mini">
                <span class="quota-label">API 配額:</span>
                <span class="quota-value" style="color: ${valueColor}">
                    ${usage.toLocaleString()} / ${limit.toLocaleString()} units (${percentage.toFixed(2)}%)
                </span>
                <span class="quota-reset">配額將在 ${resetTimeText} 後重置（PT 時區）</span>
            </div>
        `;
    }
    
    refresh() {
        this.renderLoading();
        this.fetchQuota().then(success => {
            if (success) {
                this.render();
            } else {
                this.renderError();
            }
        });
    }
    
    renderError(message = '無法載入配額狀態') {
        this.container.innerHTML = `
            <div class="quota-error">
                <span>⚠️</span>
                <span>${message}</span>
                <button onclick="window.quotaDisplay?.refresh()">重試</button>
            </div>
        `;
    }
    
    startAutoRefresh() {
        this.stopAutoRefresh();
        this.intervalId = setInterval(() => {
            this.fetchQuota().then(success => {
                if (success) {
                    this.render();
                }
            });
        }, this.options.refreshInterval);
    }
    
    stopAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    
    setupColorThemeListener() {
        // 監聽影片選擇變化，更新配額卡片邊框顏色
        const videoSelect = document.getElementById('videoSelect');
        if (videoSelect) {
            videoSelect.addEventListener('change', () => {
                const selectedOption = videoSelect.options[videoSelect.selectedIndex];
                const color = selectedOption.getAttribute('data-color');
                if (color) {
                    const card = this.container.querySelector('.quota-card');
                    if (card) {
                        card.style.borderLeftColor = color;
                    }
                }
            });
        }
    }
    
    destroy() {
        this.stopAutoRefresh();
    }
}

// 自動初始化（如果容器存在）
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('quotaDisplayContainer');
    if (container) {
        window.quotaDisplay = new QuotaDisplay('quotaDisplayContainer', {
            apiEndpoint: '/api/fetch-and-store-multi?action=quota',
            refreshInterval: 60000
        });
    }
});

// 導出供手動初始化使用
window.QuotaDisplay = QuotaDisplay;
