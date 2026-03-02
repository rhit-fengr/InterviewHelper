'use strict';

const OpenAI = require('openai');

const SUPPORTED_PROVIDERS = ['openai', 'gemini'];
const DEFAULT_PROVIDER = normalizeProvider(process.env.AI_PROVIDER || 'openai');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_DETECT_MODEL = process.env.OPENAI_DETECT_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const AI_TRANSCRIBE_MAX_BYTES = Number(process.env.AI_TRANSCRIBE_MAX_BYTES || 5 * 1024 * 1024);

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_DETECT_MODEL = process.env.GEMINI_DETECT_MODEL || GEMINI_MODEL;
const GEMINI_TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || GEMINI_MODEL;
const GEMINI_BASE_URL = ensureTrailingSlash(
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/'
);
const GEMINI_NATIVE_BASE_URL = (
  process.env.GEMINI_NATIVE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
).replace(/\/+$/, '');
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  'gemini-2.0-flash,gemini-1.5-flash'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Backward-compatible flag: whether OPENAI_API_KEY exists.
 * Existing tests/routes can keep using this if needed.
 */
const isConfigured = Boolean(process.env.OPENAI_API_KEY);
const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);

if (!isConfigured) {
  console.warn('[openai.service] WARNING: OPENAI_API_KEY is not set. OpenAI provider will return 503 until configured.');
}
if (!isGeminiConfigured) {
  console.warn('[openai.service] WARNING: GEMINI_API_KEY is not set. Gemini provider will return 503 until configured.');
}

const clientCache = new Map();

const TOKEN_LIMITS = {
  short: 200,
  medium: 500,
  long: 1000,
};
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.AI_RATE_LIMIT_COOLDOWN_MS || 60_000);
const RATE_LIMIT_MAX_COOLDOWN_MS = Number(process.env.AI_RATE_LIMIT_MAX_COOLDOWN_MS || 300_000);
/** provider -> epoch ms */
const providerCooldownUntil = new Map();

function ensureTrailingSlash(url) {
  return typeof url === 'string' && !url.endsWith('/')
    ? `${url}/`
    : url;
}

function normalizeProvider(raw) {
  if (!raw || typeof raw !== 'string') return 'openai';
  const normalized = raw.trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(normalized) ? normalized : 'openai';
}

function isProviderConfigured(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? isGeminiConfigured : isConfigured;
}

function getClient(provider) {
  const p = normalizeProvider(provider);
  if (clientCache.has(p)) return clientCache.get(p);

  let client;
  if (p === 'gemini') {
    client = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY || 'placeholder',
      baseURL: GEMINI_BASE_URL,
      maxRetries: 3,
      timeout: 30 * 1000,
    });
  } else {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'placeholder',
      maxRetries: 3,
      timeout: 30 * 1000,
    });
  }

  clientCache.set(p, client);
  return client;
}

function getAnswerModel(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL;
}

function getDetectModel(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? GEMINI_DETECT_MODEL : OPENAI_DETECT_MODEL;
}

function isGeminiBadRequest(err) {
  return err?.status === 400;
}

function buildGeminiModelCandidates(primary) {
  return [...new Set([primary, ...GEMINI_FALLBACK_MODELS])];
}

function parseRetryAfterMs(headers = {}) {
  const raw = headers?.['retry-after'];
  if (!raw) return 0;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return asNumber * 1000;
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return 0;
}

function markProviderRateLimited(provider, err) {
  const retryAfterMs = parseRetryAfterMs(err?.headers);
  const rawCooldownMs = Math.max(RATE_LIMIT_COOLDOWN_MS, retryAfterMs);
  const cooldownMs = Math.min(rawCooldownMs, RATE_LIMIT_MAX_COOLDOWN_MS);
  providerCooldownUntil.set(provider, Date.now() + cooldownMs);
}

function isProviderOnCooldown(provider) {
  const until = providerCooldownUntil.get(provider) || 0;
  return until > Date.now();
}

function getProviderCooldownRemainingMs(provider) {
  const until = providerCooldownUntil.get(provider) || 0;
  return Math.max(0, until - Date.now());
}

function buildRateLimitError(provider) {
  const err = new Error(`Provider "${provider}" is temporarily rate-limited.`);
  err.status = 429;
  err.provider = provider;
  err.retryAfterMs = getProviderCooldownRemainingMs(provider);
  return err;
}

function sanitizeMessages(messages) {
  return (messages || [])
    .filter((m) => ['system', 'user', 'assistant'].includes(m?.role))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content || ''),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function inferExtensionFromMime(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
}

function normalizeMimeType(mimeType = 'audio/webm') {
  const lower = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return lower || 'audio/webm';
}

function toGeminiAudioMimeType(mimeType = 'audio/webm') {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === 'audio/mp3') return 'audio/mpeg';
  return normalized;
}

function sanitizeLanguageHint(languageHint) {
  const candidate = String(languageHint || '').trim();
  if (!candidate) return '';
  // Keep BCP-47-ish values only.
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(candidate) ? candidate : '';
}

function extractGeminiText(response = {}) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

async function transcribeWithGemini({ audioBuffer, mimeType, languageHint }) {
  const model = encodeURIComponent(GEMINI_TRANSCRIBE_MODEL);
  const url = `${GEMINI_NATIVE_BASE_URL}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const normalizedLang = sanitizeLanguageHint(languageHint);
  const languageHintLine = normalizedLang
    ? `Language hint: ${normalizedLang}. Keep the output in this language when possible.`
    : 'No language hint provided. Detect language automatically.';

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'You are a speech-to-text engine.',
              'Transcribe the provided audio exactly.',
              'Do not add commentary.',
              languageHintLine,
            ].join(' '),
          },
          {
            inlineData: {
              mimeType: toGeminiAudioMimeType(mimeType),
              data: audioBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error?.message || `Gemini transcription failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const body = await response.json();
  const text = extractGeminiText(body);
  if (!text) {
    const err = new Error(
      'Gemini returned empty transcription for this chunk. For stable real-time STT, use OpenAI Whisper.'
    );
    err.status = 502;
    throw err;
  }
  return text;
}

/**
 * Build a system prompt personalised for the candidate.
 */
function buildSystemPrompt(personalInfo = {}, answerSettings = {}, setup = {}) {
  return `You are an expert interview coach helping ${personalInfo.fullName || 'the candidate'} in a ${setup.topic || 'general'} interview.

Candidate Profile:
- Role: ${personalInfo.currentRole || 'Not specified'}
- Company: ${personalInfo.company || 'Not specified'}
- Experience: ${personalInfo.yearsOfExperience || 'Not specified'} years
- Skills: ${personalInfo.skills || 'Not specified'}
- Work History: ${personalInfo.workHistory || 'Not specified'}
- Education: ${personalInfo.education || 'Not specified'}

Answer Settings:
- Structure: ${answerSettings.behavioralStructure || 'STAR'} (use for behavioral questions)
- Style: ${answerSettings.responseStyle || 'conversational'}
- Length: ${answerSettings.answerLength || 'medium'}
- Answer Language: ${setup.answerLang || 'en-US'}

Additional Context: ${setup.customInstructions || 'None'}

Respond naturally as if the candidate is speaking. Do not mention you are an AI. Keep answers focused and well-structured.`.trim();
}

/**
 * Generate a streaming AI answer for the given question.
 * Returns a provider stream object compatible with `for await ... of`.
 */
async function generateAnswer({
  provider,
  question,
  personalInfo,
  answerSettings,
  setup,
  conversationHistory = [],
}) {
  const selectedProvider = normalizeProvider(provider || setup?.aiProvider);
  if (isProviderOnCooldown(selectedProvider)) {
    throw buildRateLimitError(selectedProvider);
  }
  const client = getClient(selectedProvider);
  const systemPrompt = buildSystemPrompt(personalInfo, answerSettings, setup);
  const maxTokens = TOKEN_LIMITS[answerSettings?.answerLength] || TOKEN_LIMITS.medium;

  const messages = sanitizeMessages([
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-(answerSettings?.memoryLimit || 10)),
    { role: 'user', content: question },
  ]);

  const requestPayload = {
    model: getAnswerModel(selectedProvider),
    messages,
    stream: true,
  };
  if (selectedProvider !== 'gemini') {
    requestPayload.max_tokens = maxTokens;
  }

  try {
    return await client.chat.completions.create(requestPayload);
  } catch (err) {
    // Gemini's OpenAI-compatible endpoint can return HTTP 400 for payloads that are valid for
    // OpenAI (e.g., long or complex conversation histories or certain role combinations).
    // In that case, retry with model/payload fallbacks to maximize compatibility.
    if (err?.status === 429) {
      markProviderRateLimited(selectedProvider, err);
      throw err;
    }

    if (selectedProvider === 'gemini' && isGeminiBadRequest(err)) {
      const candidates = buildGeminiModelCandidates(getAnswerModel(selectedProvider));
      const minimalWithSystem = sanitizeMessages([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ]);
      const userOnly = sanitizeMessages([{ role: 'user', content: question }]);

      for (const model of candidates) {
        try {
          return await client.chat.completions.create({
            model,
            messages: minimalWithSystem,
            stream: true,
          });
        } catch (retryErr) {
          if (retryErr?.status === 429) {
            markProviderRateLimited(selectedProvider, retryErr);
            throw retryErr;
          }
          if (!isGeminiBadRequest(retryErr)) throw retryErr;
        }

        try {
          return await client.chat.completions.create({
            model,
            messages: userOnly,
            stream: true,
          });
        } catch (retryErr) {
          if (retryErr?.status === 429) {
            markProviderRateLimited(selectedProvider, retryErr);
            throw retryErr;
          }
          if (!isGeminiBadRequest(retryErr)) throw retryErr;
        }
      }
    }
    throw err;
  }
}

async function transcribeAudioChunk({
  provider,
  audioBuffer,
  mimeType = 'audio/webm',
  languageHint,
}) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    const err = new Error('audio chunk is required');
    err.status = 400;
    throw err;
  }

  if (audioBuffer.length > AI_TRANSCRIBE_MAX_BYTES) {
    const err = new Error(`audio chunk exceeds max size (${AI_TRANSCRIBE_MAX_BYTES} bytes)`);
    err.status = 413;
    throw err;
  }

  const selectedProvider = normalizeProvider(provider);
  const transcriptionProvider = selectedProvider === 'gemini' ? 'gemini' : 'openai';

  if (!isProviderConfigured(transcriptionProvider)) {
    const err = new Error(
      transcriptionProvider === 'gemini'
        ? 'Audio transcription requires GEMINI_API_KEY.'
        : 'Audio transcription requires OPENAI_API_KEY.'
    );
    err.status = 503;
    throw err;
  }

  if (isProviderOnCooldown(transcriptionProvider)) {
    throw buildRateLimitError(transcriptionProvider);
  }

  try {
    if (transcriptionProvider === 'gemini') {
      return await transcribeWithGemini({ audioBuffer, mimeType, languageHint });
    }

    const client = getClient(transcriptionProvider);
    const file = await OpenAI.toFile(
      audioBuffer,
      `chunk.${inferExtensionFromMime(mimeType)}`,
      { type: normalizeMimeType(mimeType) }
    );

    const payload = {
      file,
      model: OPENAI_TRANSCRIBE_MODEL,
    };
    const normalizedLang = sanitizeLanguageHint(languageHint);
    if (normalizedLang) payload.language = normalizedLang;

    const result = await client.audio.transcriptions.create(payload);
    return String(result?.text || '').trim();
  } catch (err) {
    if (err?.status === 429) {
      markProviderRateLimited(transcriptionProvider, err);
      throw buildRateLimitError(transcriptionProvider);
    }
    throw err;
  }
}

function tryParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

/**
 * Detect whether a transcript contains an interview question.
 * Returns { isQuestion: boolean, question: string|null }.
 */
async function detectQuestion(transcript, sensitivity = 'medium', provider) {
  const selectedProvider = normalizeProvider(provider);
  if (isProviderOnCooldown(selectedProvider)) {
    return heuristicQuestionDetection(transcript);
  }
  const client = getClient(selectedProvider);
  const sensitivityPrompts = {
    low: 'Only return true if there is a very clear, explicit question with a question mark.',
    medium: 'Return true for clear questions and reasonably implied questions.',
    high: 'Return true for explicit questions, implicit questions, and subtle prompts like "tell me about..." or "walk me through..."',
  };

  const requestPayload = {
    model: getDetectModel(selectedProvider),
    messages: [
      {
        role: 'user',
        content: `Transcript: "${transcript}"\n\n${sensitivityPrompts[sensitivity] || sensitivityPrompts.medium}\n\nReturn valid JSON only: {"isQuestion": boolean, "question": "extracted question or null"}`,
      },
    ],
  };
  if (selectedProvider !== 'gemini') {
    requestPayload.max_tokens = 150;
  }

  let response;
  try {
    response = await client.chat.completions.create(requestPayload);
  } catch (err) {
    if (err?.status === 429) {
      markProviderRateLimited(selectedProvider, err);
      return heuristicQuestionDetection(transcript);
    }

    if (selectedProvider === 'gemini' && isGeminiBadRequest(err)) {
      console.warn('[detectQuestion] Gemini returned 400; using heuristic fallback.');
      return heuristicQuestionDetection(transcript);
    }
    throw err;
  }

  const raw = response.choices?.[0]?.message?.content || '';
  const parsed = tryParseJson(raw);

  if (parsed && typeof parsed.isQuestion === 'boolean') {
    return {
      isQuestion: parsed.isQuestion,
      question: parsed.question || null,
    };
  }

  // Fallback: basic heuristic based on position of the last '?' and log usage for monitoring.
  console.warn('[detectQuestion] Falling back to heuristic question detection; raw response was not valid JSON:', raw);

  return heuristicQuestionDetection(transcript);
}

function heuristicQuestionDetection(transcript) {
  const text = typeof transcript === 'string' ? transcript.trim() : '';
  let fallbackIsQuestion = false;
  let fallbackQuestion = null;

  if (text) {
    const lastQuestionMarkIndex = text.lastIndexOf('?');

    if (lastQuestionMarkIndex !== -1) {
      // Consider it a question only if the '?' is at/near the end (little or no trailing text).
      const trailingText = text.slice(lastQuestionMarkIndex + 1).trim();
      if (trailingText.length === 0 || trailingText.length <= 20) {
        fallbackIsQuestion = true;

        // Extract the likely question: from the last sentence boundary up to and including the '?'.
        const lastPeriod = text.lastIndexOf('.', lastQuestionMarkIndex);
        const lastExclamation = text.lastIndexOf('!', lastQuestionMarkIndex);
        const lastNewline = text.lastIndexOf('\n', lastQuestionMarkIndex);
        const lastBoundary = Math.max(lastPeriod, lastExclamation, lastNewline);

        fallbackQuestion = text
          .slice(lastBoundary + 1, lastQuestionMarkIndex + 1)
          .trim();

        if (!fallbackQuestion) {
          fallbackQuestion = text;
        }
      }
    }
  }

  return {
    isQuestion: fallbackIsQuestion,
    question: fallbackIsQuestion ? fallbackQuestion : null,
  };
}

module.exports = {
  generateAnswer,
  detectQuestion,
  transcribeAudioChunk,
  buildSystemPrompt,
  normalizeProvider,
  isProviderConfigured,
  getProviderCooldownRemainingMs,
  isConfigured,
};
