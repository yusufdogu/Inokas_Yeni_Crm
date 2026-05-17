// transcribe.js — Whisper transcription using axios + form-data
'use strict';

const express   = require('express');
const axios     = require('axios');
const FormData  = require('form-data');
const router    = express.Router();

router.post('/', (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY eksik' });
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const audioBuffer = Buffer.concat(chunks);
      if (!audioBuffer.length) {
        return res.status(400).json({ error: 'Ses verisi boş' });
      }

      const mimeType = req.headers['content-type'] || 'audio/webm';
      const ext      = mimeType.includes('mp4') ? 'mp4'
                     : mimeType.includes('ogg') ? 'ogg'
                     : 'webm';

      const form = new FormData();
      form.append('model',    'whisper-1');
      form.append('language', 'tr');
      form.append('file', audioBuffer, {
        filename:    `audio.${ext}`,
        contentType: mimeType,
      });

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            ...form.getHeaders(),
          },
          maxBodyLength: Infinity,
        }
      );

      res.json({ text: response.data.text || '' });

    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.error('Transcribe hatası:', msg);
      res.status(500).json({ error: msg });
    }
  });
});

module.exports = router;