// api/fetch-and-store.js
import { kv } from '@vercel/kv';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

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

  if (!YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: API Key missing' });
  }

  try {
    const youtubeUrl = `${YOUTUBE_API_BASE}?id=${VIDEO_ID}&part=statistics&key=${YOUTUBE_API_KEY}`;
    const youtubeResponse = await fetch(youtubeUrl);

    if (!youtubeResponse.ok) {
      const errorData = await youtubeResponse.text();
      console.error(`YouTube API Error: ${youtubeResponse.status} - ${errorData}`);
      return res.status(youtubeResponse.status).json({ error: `YouTube API Error: ${errorData}` });
    }

    const youtubeData = await youtubeResponse.json();

    if (!youtubeData.items || youtubeData.items.length === 0) {
      console.error(`Video not found: ${VIDEO_ID}`);
      return res.status(404).json({ error: 'Video not found' });
    }

    const viewCount = parseInt(youtubeData.items[0].statistics.viewCount, 10);
    const timestamp = Date.now();

    // --- 儲存邏輯 ---
    // 使用日期作為鍵，格式為 "videoId:YYYY-MM-DD"
    const dateStr = new Date(timestamp).toISOString().split('T')[0]; // 例如 "2025-12-25"
    const dataKey = `${VIDEO_ID}:${dateStr}`;
    const keyListKey = `${VIDEO_ID}:keys`;

    // 儲存數據
    const value = { timestamp, viewCount };
    await kv.set(dataKey, value);

    // 更新鍵列表 (記錄所有有數據的日期)
    let keyList = await kv.get(keyListKey) || [];
    if (!keyList.includes(dataKey)) {
        keyList.push(dataKey);
        // 限制列表大小，例如只保留最近 365 天的點 (可選)
        if (keyList.length > 365) {
          keyList = keyList.slice(-365);
        }
        await kv.set(keyListKey, keyList);
    }
    // --- 儲存邏輯結束 ---

    console.log(`Stored data for ${VIDEO_ID}: ${viewCount} at ${new Date(timestamp).toISOString()}`);

    res.status(200).json({ message: 'Data fetched and stored successfully', data: value });
  } catch (error) {
    console.error('Error fetching or storing data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const config = {
  runtime: 'edge',
};