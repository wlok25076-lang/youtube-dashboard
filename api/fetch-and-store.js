// api/fetch-and-store.js
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GIST_ID = process.env.GIST_ID; // 您的 Gist ID
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // 您的 GitHub PAT

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 驗證是否為 Cron Job 的請求 (重要：防止被隨意呼叫)
  const cronAuth = req.headers['authorization'];
  const expectedAuth = `Bearer ${process.env.CRON_AUTH_TOKEN}`;
  if (process.env.NODE_ENV === 'production' && cronAuth !== expectedAuth) {
    console.log('Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const VIDEO_ID = 'm2ANkjMRuXc'; // 你要追蹤的固定影片 ID

  if (!YOUTUBE_API_KEY || !GIST_ID || !GITHUB_TOKEN) {
    console.error('Missing required environment variables');
    return res.status(500).json({ error: 'Server configuration error: Missing API Key, Gist ID, or GitHub Token' });
  }

  try {
    const youtubeUrl = `${YOUTUBE_API_BASE}?id=${VIDEO_ID}&part=statistics&key=${YOUTUBE_API_KEY}`;
    const youtubeResponse = await fetch(youtubeUrl);

    if (!youtubeResponse.ok) {
      const errorText = await youtubeResponse.text(); // 使用 text() 避免 json() 可能的錯誤
      console.error(`YouTube API Error: ${youtubeResponse.status} - ${errorText}`);
      return res.status(youtubeResponse.status).json({ error: `YouTube API Error: ${errorText}` });
    }

    let youtubeData;
    try {
      youtubeData = await youtubeResponse.json(); // 包在 try-catch
    } catch (jsonError) {
      console.error('Failed to parse JSON response from YouTube API:', jsonError);
      return res.status(502).json({ error: 'Bad Gateway: Failed to parse response from YouTube' });
    }

    if (!youtubeData.items || youtubeData.items.length === 0) {
      console.error(`Video not found: ${VIDEO_ID}`);
      return res.status(404).json({ error: 'Video not found' });
    }

    const viewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);
    const timestamp = Date.now();

    // --- 讀取現有 Gist 數據 ---
    const gistResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'vercel-app' // GitHub API 要求 User-Agent
      }
    });

    if (!gistResponse.ok) { // 檢查 HTTP 狀態碼是否表示成功 (2xx)
      console.error(`GitHub API Error fetching gist: ${gistResponse.status} - ${gistResponse.statusText}`);
      return res.status(gistResponse.status).json({ error: 'Failed to fetch gist data' });
    }

    let gistData;
    try {
      // 將 gistResponse.json() 也包在 try-catch 中
      gistData = await gistResponse.json();
    } catch (jsonError) {
      console.error('Failed to parse JSON response from GitHub API while fetching gist:', jsonError);
      return res.status(502).json({ error: 'Bad Gateway: Failed to parse response from GitHub' });
    }

    const fileName = 'youtube-data.json'; // 與您建立 Gist 時的檔名一致
    let currentData = [];

    if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        currentData = JSON.parse(gistData.files[fileName].content);
      } catch (parseError) {
        console.warn('Failed to parse existing gist content as JSON, starting fresh.', parseError);
        currentData = [];
      }
    }

    // --- 新增數據 ---
    const newEntry = { timestamp, viewCount, date: new Date(timestamp).toISOString().split('T')[0] };
    currentData.push(newEntry);

    // --- 更新 Gist ---
    const updatedContent = JSON.stringify(currentData, null, 2); // 格式化 JSON
    const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'vercel-app'
      },
      body: JSON.stringify({
        files: {
          [fileName]: {
            content: updatedContent
          }
        }
      })
    });

    if (!updateResponse.ok) { // 檢查 HTTP 狀態碼是否表示成功 (2xx)
      console.error(`GitHub API Error updating gist: ${updateResponse.status} - ${updateResponse.statusText}`);
      return res.status(updateResponse.status).json({ error: 'Failed to update gist data' });
    }

    // 再次將 updateResponse.json() 包在 try-catch (雖然 PATCH 通常沒有 body，但 API 可能會返回)
    try {
       await updateResponse.json(); // 通常 PATCH 不會有 JSON body，但為了保險起見
    } catch (jsonError) {
       // 忽略這個錯誤，因為 PATCH 通常不需要處理 JSON response body
       console.warn('Warning: Failed to parse JSON response from GitHub API while updating gist (this might be normal).', jsonError);
    }

    console.log(`Stored data for ${VIDEO_ID}: ${viewCount} at ${new Date(timestamp).toISOString()}`);

    res.status(200).json({ message: 'Data fetched and stored successfully', data: newEntry });
  } catch (error) {
    // 在這裡，'error' 是一個錯誤物件，不是 Response 物件
    console.error('Error fetching or storing data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const config = {
  runtime: 'nodejs', // <--- 改為 nodejs
};