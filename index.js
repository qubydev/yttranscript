import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import { fetchTranscript } from './youtube-transcript.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const scraperApiFetch = async (url, options = {}) => {
  const apiKey = process.env.SCRAPERAPI_API_KEY;
  const targetUrl = typeof url === 'string' ? url : url.toString();
  const proxyUrl = `http://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&keep_headers=true`;
  
  return fetch(proxyUrl, options);
};

app.get('/', (req, res) => {
  res.send('Hi there!');
});

app.get('/transcript', async (req, res) => {
  const videoId = req.query.video;
  const lang = req.query.lang;

  if (!videoId) {
    return res.status(400).json({ error: 'Missing video parameter. Please provide a video ID or URL.' });
  }
  
  try {
    const transcript = await fetchTranscript(videoId, { 
      lang,
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