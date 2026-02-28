'use strict';

const express = require('express');
const {
  generateAnswer,
  detectQuestion,
  normalizeProvider,
  isProviderConfigured,
} = require('../services/openai.service');

const router = express.Router();

function getProviderFromRequest(req) {
  return normalizeProvider(
    req.body?.provider ||
    req.body?.setup?.aiProvider ||
    process.env.AI_PROVIDER ||
    'openai'
  );
}

/**
 * POST /api/ai/answer
 * Body: { question, personalInfo, answerSettings, setup, conversationHistory, provider? }
 * Response: Server-Sent Events stream of answer chunks (JSON-encoded)
 */
router.post('/answer', async (req, res) => {
  const provider = getProviderFromRequest(req);
  if (!isProviderConfigured(provider)) {
    const keyHint = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    return res.status(503).json({
      error: `AI service (${provider}) is not configured. Set ${keyHint}.`,
    });
  }

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
    stream = await generateAnswer({
      provider,
      question,
      personalInfo,
      answerSettings,
      setup,
      conversationHistory,
    });
  } catch (err) {
    console.error('[AI answer] stream init error:', err);
    const userMessage = err?.status === 429
      ? 'Rate limit reached. Please wait a moment and try again.'
      : 'Failed to start answer generation';
    res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    try { stream.controller?.abort(); } catch { /* ignore */ }
  });

  try {
    for await (const chunk of stream) {
      if (res.writableEnded) break;
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
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
 * Body: { transcript, sensitivity, provider? }
 * Response: { isQuestion, question }
 */
router.post('/detect-question', async (req, res) => {
  const provider = getProviderFromRequest(req);
  if (!isProviderConfigured(provider)) {
    const keyHint = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    return res.status(503).json({
      error: `AI service (${provider}) is not configured. Set ${keyHint}.`,
    });
  }

  const { transcript, sensitivity } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  try {
    const result = await detectQuestion(transcript, sensitivity, provider);
    res.json(result);
  } catch (err) {
    console.error('[AI detect-question] error:', err);
    res.status(500).json({ error: 'Question detection failed' });
  }
});

module.exports = router;
