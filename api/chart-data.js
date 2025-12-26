// api/chart-data.js
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  // 簡單地從Gist讀取並返回所有數據
  const response = await fetch(`https://api.github.com/gists/${GIST_ID}`);
  const gistData = await response.json();
  const data = JSON.parse(gistData.files['youtube-data.json'].content);
  
  res.status(200).json(data);
}