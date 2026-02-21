'use strict';

const express = require('express');
const { generateAnswer, detectQuestion } = require('../services/openai.service');

const router = express.Router();

/**
 * POST /api/ai/answer
 * Body: { question, personalInfo, answerSettings, setup, conversationHistory }
 * Response: Server-Sent Events stream of answer chunks (JSON-encoded)
 */
router.post('/answer', async (req, res) => {
  const { question, personalInfo, answerSettings, setup, conversationHistory } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let stream;
  try {
    stream = await generateAnswer({ question, personalInfo, answerSettings, setup, conversationHistory });
  } catch (err) {
    console.error('[AI answer] stream init error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Failed to start answer generation' })}\n\n`);
    res.end();
    return;
  }

  // Cancel the OpenAI stream when the client disconnects
  req.on('close', () => {
    try { stream.controller?.abort(); } catch { /* ignore */ }
  });

  try {
    for await (const chunk of stream) {
      if (res.writableEnded) break;
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        // JSON-encode so embedded newlines don't break SSE framing
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error('[AI answer] stream error:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'Answer generation failed' })}\n\n`);
      res.end();
    }
  }
});

/**
 * POST /api/ai/detect-question
 * Body: { transcript, sensitivity }
 * Response: { isQuestion, question }
 */
router.post('/detect-question', async (req, res) => {
  const { transcript, sensitivity } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  try {
    const result = await detectQuestion(transcript, sensitivity);
    res.json(result);
  } catch (err) {
    console.error('[AI detect-question] error:', err);
    res.status(500).json({ error: 'Question detection failed' });
  }
});

module.exports = router;
