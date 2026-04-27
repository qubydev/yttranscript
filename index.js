import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fetchTranscript, listTranscripts } from './yt.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const scraperApiFetch = async (url, options = {}) => {
  const apiKey = process.env.SCRAPERAPI_API_KEY;
  const targetUrl = typeof url === 'string' ? url : url.toString();
  const proxyUrl = `http://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&keep_headers=true`;
  
  return fetch(proxyUrl, options);
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/videos/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  try {
    const tracks = await listTranscripts(videoId, { 
      fetch: scraperApiFetch 
    });
    res.json({ success: true, data: tracks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/videos/:videoId/transcript', async (req, res) => {
  const { videoId } = req.params;
  const { lang, kind } = req.query;
  
  try {
    const transcript = await fetchTranscript(videoId, { 
      lang,
      kind,
      fetch: scraperApiFetch 
    });
    res.json({ success: true, data: transcript });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});