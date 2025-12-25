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

    if (!response.ok) { // 檢查 HTTP 狀態碼是否表示成功 (2xx)
      console.error(`GitHub API Error: ${response.status} - ${response.statusText}`);
      return res.status(response.status).json({ error: 'Failed to fetch gist data' });
    }

    let gistData;
    try {
      // 將 json() 呼叫也包在 try-catch 中
      gistData = await response.json();
    } catch (jsonError) {
      console.error('Failed to parse JSON response from GitHub API:', jsonError);
      // GitHub API 在某些錯誤情況下可能回傳非 JSON 格式，但 status code 卻是 2xx，較少見
      // 或者網路問題導致 response body 不完整
      return res.status(502).json({ error: 'Bad Gateway: Failed to parse response from GitHub' });
    }

    const fileName = 'youtube-data.json'; // 與您建立 Gist 時的檔名一致
    let data = [];
    if (gistData.files && gistData.files[fileName] && gistData.files[fileName].content) {
      try {
        data = JSON.parse(gistData.files[fileName].content);
        // 確保數據按時間戳記排序 (確保圖表按時間順序)
        data.sort((a, b) => a.timestamp - b.timestamp);
      } catch (parseError) {
        console.error('Failed to parse gist content as JSON:', parseError);
        data = [];
        // return res.status(500).json({ error: 'Failed to parse gist data' }); // 或者返回錯誤
      }
    }

    res.status(200).json(data);
  } catch (error) {
    // 在這裡，'error' 是一個錯誤物件，不是 Response 物件
    console.error('Error fetching chart data:', error);
    // 如果是 fetch 失敗 (例如網路問題)，通常會沒有 status 屬性
    // 我們統一返回 500
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const config = {
  runtime: 'edge',
};