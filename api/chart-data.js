// api/chart-data.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const VIDEO_ID = 'm2ANkjMRuXc'; // 你要顯示的固定影片 ID

  try {
    // 獲取鍵列表
    const keyListKey = `${VIDEO_ID}:keys`;
    let keyList = await kv.get(keyListKey) || [];

    // 根據鍵列表獲取所有對應的數據
    const data = [];
    for (const key of keyList) {
      const value = await kv.get(key);
      if (value) {
        data.push(value);
      }
    }

    // 按時間戳記排序 (確保圖表按時間順序)
    data.sort((a, b) => a.timestamp - b.timestamp);

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching chart data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const config = {
  runtime: 'edge',
};