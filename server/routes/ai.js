'use strict';

const express = require('express');
const multer = require('multer');
const {
  generateAnswer,
  detectQuestion,
  getProviderCooldownRemainingMs,
  normalizeProvider,
  normalizeTranscribeProvider,
  isProviderConfigured,
  isTranscribeProviderConfigured,
  transcribeAudioChunk,
  AI_TRANSCRIBE_MAX_BYTES,
} = require('../services/openai.service');

const router = express.Router();
const MAX_QUESTION_CHARS = Number(process.env.AI_MAX_QUESTION_CHARS || 1600);
const MAX_TRANSCRIPT_CHARS = Number(process.env.AI_MAX_TRANSCRIPT_CHARS || 2400);
const ENABLE_PROVIDER_FAILOVER = process.env.AI_ENABLE_PROVIDER_FAILOVER !== 'false';
const transcribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AI_TRANSCRIBE_MAX_BYTES },
});

function clipTail(text, maxChars) {
  const value = String(text || '').trim();
  if (!value) return '';
  const limit = Math.max(1, Number(maxChars) || 1600);
  return value.length <= limit ? value : value.slice(-limit).trim();
}

function getAlternativeProvider(provider) {
  return provider === 'gemini' ? 'openai' : 'gemini';
}

function getProviderFromRequest(req) {
  return normalizeProvider(
    req.body?.provider ||
    req.body?.setup?.aiProvider ||
    process.env.AI_PROVIDER ||
    'openai'
  );
}

function getTranscribeProviderFromRequest(req) {
  const rawExplicit = req.body?.transcribeProvider || req.body?.sttProvider;
  const explicitRaw = typeof rawExplicit === 'string' ? rawExplicit.trim().toLowerCase() : '';
  if (explicitRaw === 'openai' || explicitRaw === 'gemini' || explicitRaw === 'local' || explicitRaw === 'windows-live-captions') {
    return normalizeTranscribeProvider(explicitRaw);
  }

  if (isTranscribeProviderConfigured('openai')) return 'openai';
  if (isTranscribeProviderConfigured('local')) return 'local';
  if (isTranscribeProviderConfigured('gemini')) return 'gemini';

  return getProviderFromRequest(req);
}

function getTranscribeProviderChain(req) {
  const sourceMode = String(req.body?.sourceMode || '').trim().toLowerCase();
  const rawExplicit = req.body?.transcribeProvider || req.body?.sttProvider;
  const explicitRaw = typeof rawExplicit === 'string' ? rawExplicit.trim().toLowerCase() : '';
  if (explicitRaw === 'openai' || explicitRaw === 'gemini' || explicitRaw === 'local' || explicitRaw === 'windows-live-captions') {
    return [normalizeTranscribeProvider(explicitRaw)];
  }

  // In auto mode, prioritize regular audio STT providers first.
  // Windows Live Captions is a useful fallback for system audio but should not block the path.
  const preferredCandidates = sourceMode === 'system'
    ? ['windows-live-captions', 'local', 'openai', 'gemini']
    : ['openai', 'local', 'gemini'];
  const candidates = preferredCandidates.filter((provider) => (
    isTranscribeProviderConfigured(provider)
  ));

  if (candidates.length > 0) return candidates;
  return [getTranscribeProviderFromRequest(req)];
}

function canFailoverTranscribeError(err) {
  const status = Number(err?.status) || 0;
  // Provider/runtime issues that are usually recoverable by trying the next provider.
  return [429, 500, 502, 503, 504].includes(status);
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

  const clippedQuestion = clipTail(question, MAX_QUESTION_CHARS);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let stream;
  let initError = null;
  try {
    stream = await generateAnswer({
      provider,
      question: clippedQuestion,
      personalInfo,
      answerSettings,
      setup,
      conversationHistory,
    });
  } catch (err) {
    initError = err;
    if (ENABLE_PROVIDER_FAILOVER && err?.status === 429) {
      const fallbackProvider = getAlternativeProvider(provider);
      if (isProviderConfigured(fallbackProvider)) {
        try {
          stream = await generateAnswer({
            provider: fallbackProvider,
            question: clippedQuestion,
            personalInfo,
            answerSettings,
            setup,
            conversationHistory,
          });
          console.warn(`[AI answer] failover applied: ${provider} -> ${fallbackProvider}`);
        } catch (fallbackErr) {
          initError = fallbackErr;
        }
      }
    }
  }

  if (!stream) {
    const cooldownMs = initError?.retryAfterMs || getProviderCooldownRemainingMs(initError?.provider || provider);
    const cooldownSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
    console.error('[AI answer] stream init error:', initError);
    let userMessage = 'Failed to start answer generation';
    if (initError?.status === 429) {
      userMessage = `Rate limit reached for ${initError?.provider || provider}. Wait about ${cooldownSeconds}s and try again, or switch AI Provider.`;
    } else if ((initError?.provider || provider) === 'gemini' && initError?.status === 400) {
      userMessage = 'Gemini rejected this request (400). Check your request parameters and Gemini configuration (e.g., GEMINI_MODEL, GEMINI_API_KEY) and try again.';
    }
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
    const result = await detectQuestion(
      clipTail(transcript, MAX_TRANSCRIPT_CHARS),
      sensitivity,
      provider
    );
    res.json(result);
  } catch (err) {
    console.error('[AI detect-question] error:', err);
    res.status(500).json({ error: 'Question detection failed' });
  }
});

/**
 * POST /api/ai/transcribe-chunk
 * multipart/form-data:
 *  - audio: Blob/File chunk
 *  - provider?: openai|gemini
 *  - transcribeProvider?: auto|openai|local|gemini|windows-live-captions
 *  - language?: BCP-47 hint
 *  - sourceMode?: mic|system|mic-system
 */
router.post('/transcribe-chunk', (req, res, next) => {
  transcribeUpload.single('audio')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Audio chunk exceeds the maximum allowed size.' });
    }
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  const providerChain = getTranscribeProviderChain(req);
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'audio chunk is required' });
  }

  try {
    let lastError = null;
    for (let index = 0; index < providerChain.length; index += 1) {
      const provider = providerChain[index];
      try {
        const text = await transcribeAudioChunk({
          provider,
          audioBuffer: req.file.buffer,
          mimeType: req.file.mimetype,
          languageHint: req.body?.language,
          sourceMode: req.body?.sourceMode,
        });
        const normalizedText = String(text || '').trim();
        const isLastAttempt = index >= providerChain.length - 1;
        if (!normalizedText && !isLastAttempt) {
          console.warn(
            `[AI transcribe-chunk] provider ${provider} returned empty text; trying next provider`
          );
          continue;
        }
        return res.json({
          text: normalizedText,
          sourceMode: req.body?.sourceMode || 'unknown',
          providerUsed: provider,
        });
      } catch (err) {
        lastError = err;
        const isLastAttempt = index >= providerChain.length - 1;
        if (isLastAttempt || !canFailoverTranscribeError(err)) {
          throw err;
        }
        console.warn(
          `[AI transcribe-chunk] provider ${provider} failed with status ${Number(err?.status) || 500}; trying next provider`
        );
      }
    }
    throw lastError || new Error('Audio transcription failed');
  } catch (err) {
    console.error('[AI transcribe-chunk] error:', err);
    const status = Number(err?.status) || 500;
    if (status === 429) {
      const cooldownMs = err?.retryAfterMs || getProviderCooldownRemainingMs(err?.provider || 'openai');
      const cooldownSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
      return res.status(429).json({
        error: `Transcription rate limit reached. Wait about ${cooldownSeconds}s and retry.`,
      });
    }
    if (status === 503) {
      return res.status(503).json({
        error: err?.message || `Transcription service (${providerChain[0] || 'unknown'}) is not configured.`,
      });
    }
    return res.status(status).json({
      error: err?.message || 'Audio transcription failed',
    });
  }
});

module.exports = router;
