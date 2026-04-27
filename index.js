import express from 'express';
import cors from 'cors';
import { fetchTranscript } from './youtube-transcript.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.get('/transcript', async (req, res) => {
  const videoId = req.query.video;
  const lang = req.query.lang;

  if (!videoId) {
    return res.status(400).json({ error: 'Missing video parameter. Please provide a video ID or URL.' });
  }
  try {
    const transcript = await fetchTranscript(videoId, { lang });
    res.json({ success: true, data: transcript });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});