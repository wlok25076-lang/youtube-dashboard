// api/chart-data.js
const GIST_ID = process.env.GIST_ID; // 您的 Gist ID
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // 您的 GitHub PAT

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GIST_ID || !GITHUB_TOKEN) {
    console.error('Missing GIST_ID or GITHUB_TOKEN');
    return res.status(500).json({ error: 'Server configuration error: Missing Gist ID or GitHub Token' });
  }

  try {
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'vercel-app'
      }
    });

    if (!response.ok) {
      console.error(`GitHub API Error: ${response.status}`);
      return res.status(response.status).json({ error: 'Failed to fetch gist data' });
    }

    const gistData = await response.json();
    const fileName = 'youtube-data.json'; // 與您建立 Gist 時的檔名一致

    let data = [];
    if (gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        data = JSON.parse(gistData.files[fileName].content);
        // 確保數據按時間戳記排序 (確保圖表按時間順序)
        data.sort((a, b) => a.timestamp - b.timestamp);
      } catch (e) {
        console.error('Failed to parse gist content as JSON:', e);
        data = [];
      }
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching chart data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const config = {
  runtime: 'edge',
};