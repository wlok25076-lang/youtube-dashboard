<!-- Vercel Integration -->  
# YouTube 多影片播放量追蹤儀表板

一個功能完整的 YouTube 影片播放量追蹤系統，支援多影片管理、即時監控、數據比較等功能。

## ✨ 功能特性

### 📊 數據監控
- **即時播放量追蹤** - 監控多個 YouTube 影片的播放量變化
- **Like 數統計** - 記錄並顯示影片的 Like 數及變化趨勢
- **最近 24 小時播放量** - 透過 YouTube Analytics API 獲取精確的 24 小時播放量數據
- **今日增長統計** - 顯示當日播放量增長
- **平均每小時增長** - 計算平均每小時的播放量變化
- **發佈日期顯示** - 自動從 YouTube API 獲取影片發佈日期

### 🎬 影片管理
- **動態影片清單** - 可隨時新增、編輯、刪除追蹤的影片
- **自訂顏色標記** - 為每個影片配置專屬顏色
- **密碼保護** - 管理功能需要密碼驗證
- **後端同步** - 影片清單儲存在 Gist，跨裝置同步

### 📈 數據比較
- **多影片比較** - 最多可同時比較 3 個影片
- **彈性時間範圍** - 24 小時、7 天、30 天或全部數據
- **圖表對比** - 視覺化比較不同影片的播放量趨勢
- **數據導出** - 支援 CSV 格式匯出

### 📋 詳細數據表
- **分頁載入** - 大量數據分批顯示，提升效能
- **變化趨勢** - 顯示每筆記錄的播放量變化
- **Like 數變化** - 記錄 Like 數的增減

## 🔧 環境需求

- Node.js 18+
- npm 或 yarn
- Vercel 帳號（用於部署）
- YouTube Data API Key
- YouTube Analytics API Key
- GitHub Personal Access Token
- GitHub Gist ID

## 📦 安裝

1. **Clone 專案**
   ```bash
   git clone <your-repo-url>
   cd youtube-dashboard
   ```

2. **安裝依賴**
   ```bash
   npm install
   ```

3. **設定環境變數**
   
   創建 `.env` 檔案：
   ```env
   # YouTube API
   YOUTUBE_API_KEY=your_youtube_data_api_key
   YOUTUBE_ANALYTICS_API_KEY=your_youtube_analytics_api_key
   YOUTUBE_CHANNEL_ID=your_channel_id
   
   # GitHub
   GITHUB_TOKEN=your_github_personal_access_token
   GIST_ID=your_gist_id
   
   # 管理密碼
   ADMIN_PASSWORD=your_admin_password
   
   # 追蹤的影片（可選，預設值在 videos-config.js）
   TRACKED_VIDEOS=[{"id":"m2ANkjMRuXc","name":"影片名稱","color":"#0070f3"}]
   ```

4. **本機測試**

   有兩種方式：

   - **完整 API 測試**（需要 `/api/...` 端點）：
     ```bash
     npm run dev:vercel
     ```
     這會使用 Vercel CLI 啟動，可完整測試所有 API。

   - **僅靜態頁面**：
     ```bash
     npm run dev:static
     ```
     這會啟動靜態伺服器（支援 SPA fallback），打開 http://localhost:3000

   > ⚠️ **注意**：請在 repo 根目錄執行此指令。`-s` 參數用於 Single Page Application fallback，可避免路由或頁面刷新時出現 404。
   >
   > 請勿將 `vercel dev` 放在 `scripts.dev` 中，否則 Vercel CLI 會被誤認為是 Development Command，導致遞迴呼叫（recursive invocation）問題。

## 🚀 部署到 Vercel

1. **推送程式碼到 GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **連接到 Vercel**
   - 登入 [Vercel](https://vercel.com)
   - Import GitHub Repository
   - 設定環境變數
   - Deploy

3. **環境變數設定**
   在 Vercel Dashboard 的 Settings → Environment Variables 中添加：
   - `YOUTUBE_API_KEY`
   - `YOUTUBE_ANALYTICS_API_KEY`
   - `YOUTUBE_CHANNEL_ID`
   - `GITHUB_TOKEN`
   - `GIST_ID`
   - `ADMIN_PASSWORD`

## 📡 API 端點

### `/api/chart-data`
獲取影片播放量數據。

**查詢參數：**
- `videoId` - 影片 ID（必填）
- `range` - 時間範圍（小時數，如 24、168、720）
- `interval` - 數據間隔（hourly、daily）
- `stats` - 是否包含統計信息（true/false）
- `limit` - 返回記錄數限制
- `includeVideoInfo` - 是否獲取 YouTube 影片資訊（true/false，預設 false）

**⚠️ 配額保護說明：**

- `includeVideoInfo` 預設為 `false`，此時不會呼叫 YouTube Data API，節省 API 配額
- 只有當需要顯示縮圖、頻道名稱等額外資訊時，才建議設為 `true`
- 影片資訊會快取 6 小時，重複請求不會消耗額外配額

**回應中的 cache 狀態（meta.cache）：**
- `gist` - Gist 資料快取狀態：`hit`（命中）或 `miss`（未命中）
- `youtube` - YouTube 資訊快取狀態：`hit`（命中）、`miss`（未命中）或 `skipped`（未請求）

**範例：**
```
/api/chart-data?videoId=m2ANkjMRuXc&stats=true
/api/chart-data?videoId=m2ANkjMRuXc&includeVideoInfo=true  # 獲取影片縮圖等資訊
```

### `/api/fetch-and-store-multi`
影片管理 API，同時包含定時收數（cron）與影片管理操作功能。

**動作（管理操作）：**
- `get` - 獲取影片清單
- `add` - 新增影片
- `update` - 更新影片
- `delete` - 刪除影片
- `verify` - 驗證密碼
- `getTitle` - 獲取影片標題

**⚠️ 安全說明：**

- **定時收數（cron）**：在 Production 環境下必須帶授權，否則會回 401。可使用以下方式：
  - Header: `Authorization: Bearer <CRON_AUTH_TOKEN>`
  - Query: `?token=<CRON_AUTH_TOKEN>` 或 `?auth=<CRON_AUTH_TOKEN>`

- **debug 模式**：`debug=1` 參數只允許在非 Production 環境使用。Production 下會回 404，避免洩漏環境資訊。

### `/api/quota-status`
獲取 YouTube API 配額使用情況。

## 🏗️ 專案結構

```
youtube-dashboard/
├── api/
│   ├── chart-data.js              # 數據 API（主功能）
│   ├── fetch-and-store-multi.js   # 影片管理 API
│   ├── quota-status.js            # 配額監控 API
│   ├── quota-manager.js           # 配額管理工具
│   └── videos-config.js           # 影片配置
├── public/
│   ├── index.html                 # 主頁面
│   ├── quota-display.js           # 配額顯示組件
│   ├── quota-display.css          # 配額顯示樣式
│   └── test-compatibility.html    # 相容性測試頁面
├── scripts/
│   └── test-24h-views.js          # 24小時播放量計算測試
├── .env.example                   # 環境變數範本
├── vercel.json                    # Vercel 設定
├── package.json
└── README.md
```

## 🚀 本地啟動

```bash
# 安裝依賴
npm install

# 完整 API 測試（使用 Vercel CLI）
npm run dev:vercel

# 或者僅靜態頁面
npm run dev:static

# 執行測試
node scripts/test-24h-views.js
```

## ✅ 本地驗證

在部署前，可使用以下指令驗證安全機制是否正常運作：

**A) Development 環境：debug=1 應回 200**
```bash
npm run dev:vercel
curl -i "http://localhost:3000/api/fetch-and-store-multi?debug=1"
# 預期：HTTP 200，回傳包含環境資訊的 JSON
```

**B) Production 環境：debug=1 應回 404**
```cmd
REM Windows CMD
set NODE_ENV=production
npm run dev:vercel
curl -i "http://localhost:3000/api/fetch-and-store-multi?debug=1"
# 預期：HTTP 404，回傳 { error: 'Not Found' }
```

> 💡 PowerShell 使用者若遇到執行原則限制，可改用 CMD 執行，或使用 `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process`。

**C) Production 環境：未帶 token 應回 401**
```bash
curl -i "http://localhost:3000/api/fetch-and-store-multi"
# 預期：HTTP 401，回傳 Unauthorized 錯誤
```

## ☁️ 部署到 Vercel

### 環境變數設定

在 Vercel Dashboard 的 **Settings → Environment Variables** 中添加以下變數：

| 變數名稱 | 說明 | 必填 |
|---------|------|------|
| `YOUTUBE_API_KEY` | YouTube Data API Key | ✅ |
| `YOUTUBE_ANALYTICS_API_KEY` | YouTube Analytics API Key | ✅ |
| `YOUTUBE_CHANNEL_ID` | YouTube Channel ID | ✅ |
| `GITHUB_TOKEN` | GitHub Personal Access Token | ✅ |
| `GIST_ID` | GitHub Gist ID（存儲影片清單） | ✅ |
| `ADMIN_PASSWORD` | 管理功能密碼 | ✅ |

**注意：** 確保 `.env` 檔案不要提交到版本控制。

## 📊 最近 24 小時播放量

### 功能說明
在儀表板首頁顯示「🕐 最近 24 小時」KPI 卡片，展示影片在最近 24 小時內的播放量增長。

### 數據來源（優先級）

1. **本地計算（首選）** - 從 Gist 存儲的小時級快照數據中計算
   - 支援新舊數據格式：`[{ts, views_total}]` 或 `[{timestamp, viewCount}]`
   - 自動處理數據不足的情況

2. **YouTube Analytics API（備用）** - 當本地數據不足時使用
   - 會消耗 API 配額
   - 需要 `YOUTUBE_ANALYTICS_API_KEY` 和 `YOUTUBE_CHANNEL_ID`

3. **今日增長（fallback）** - 當前兩者都無法使用時
   - 顯示當日香港時間的播放量增長
   - 適用於數據剛開始收集的情況

### 數據來源標記
- **gist** - 使用本地 Gist 快照計算
- **analytics_api** - 使用 YouTube Analytics API
- **unavailable** - 無法獲取數據（顯示 "--"）

### 使用方式
1. 訪問儀表板首頁
2. 在統計卡片區塊即可看到「最近 24 小時播放量」
3. 瀏覽器控制台可查看數據來源和計算過程

### 測試
```bash
node scripts/test-24h-views.js  # 測試最近 24 小時計算功能
```

## 🧹 Git history cleanup（可選）

如需清理 Git history（例如移除敏感資料或大檔案），請使用 [git-filter-repo](https://github.com/newren/git-filter-repo) 工具：

```bash
# 安裝（需 Python）
pip install git-filter-repo

# 範例：移除大檔案
git filter-repo --path-glob '大檔案名稱' --invert-paths
```

**注意**：此工具不應加入專案 repo，請自行安裝使用。

## 🔒 安全注意事項

- 管理功能需要密碼驗證
- GitHub Token 應設定最小權限（僅 Gist 讀寫）
- 定期輪換 API Key 和 Token
- 不要將環境變數提交到版本控制

### Cron / Debug 安全硬化

本專案針對定時收數與除錯功能做了以下安全強化：

- **Production 禁止 debug=1**：在 Production 環境下，`debug=1` 參數會回傳 404，而非環境資訊，避免洩漏敏感設定。
- **Production 禁止跳過 cron 認證**：`ENABLE_CRON_AUTH=false` 環境變數僅在非 Production 環境有效。Production 環境下強制要求 `CRON_AUTH_TOKEN` 授權。
- **建議 CRON_AUTH_TOKEN 使用隨機長字串**（建議 32+ 字元），並定期輪換以降低洩漏風險。

## 📄 授權

MIT License
