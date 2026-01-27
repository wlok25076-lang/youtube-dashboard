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
     打開 http://localhost:3000

   > ⚠️ **注意**：請勿將 `vercel dev` 放在 `scripts.dev` 中，否則 Vercel CLI 會被誤認為是 Development Command，導致遞迴呼叫（recursive invocation）問題。

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

**範例：**
```
/api/chart-data?videoId=m2ANkjMRuXc&stats=true
```

### `/api/fetch-and-store-multi`
影片管理 API。

**動作：**
- `get` - 獲取影片清單
- `add` - 新增影片
- `update` - 更新影片
- `delete` - 刪除影片
- `verify` - 驗證密碼
- `getTitle` - 獲取影片標題

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

## 🔒 安全注意事項

- 管理功能需要密碼驗證
- GitHub Token 應設定最小權限（僅 Gist 讀寫）
- 定期輪換 API Key 和 Token
- 不要將環境變數提交到版本控制

## 📄 授權

MIT License
