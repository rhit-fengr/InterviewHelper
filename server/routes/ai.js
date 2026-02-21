'use strict';

const express = require('express');
const { generateAnswer, detectQuestion } = require('../services/openai.service');

const router = express.Router();

function makeTraceId() {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST /api/ai/answer
 * Body: { question, personalInfo, answerSettings, setup, conversationHistory }
 * Response: Server-Sent Events stream of answer chunks
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

  try {
    const stream = await generateAnswer({ question, personalInfo, answerSettings, setup, conversationHistory });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        res.write(`data: ${text}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const traceId = makeTraceId();
    console.error(`[AI_STREAM_ERROR] ${traceId}`, err);
    res.write(`data: [ERROR] Failed to generate answer. Reference: ${traceId}\n\n`);
    res.end();
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
