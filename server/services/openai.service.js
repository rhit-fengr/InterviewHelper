'use strict';

const OpenAI = require('openai');

const SUPPORTED_PROVIDERS = ['openai', 'gemini'];
const DEFAULT_PROVIDER = normalizeProvider(process.env.AI_PROVIDER || 'openai');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_DETECT_MODEL = process.env.OPENAI_DETECT_MODEL || 'gpt-4o-mini';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_DETECT_MODEL = process.env.GEMINI_DETECT_MODEL || GEMINI_MODEL;
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';

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
  const client = getClient(selectedProvider);
  const systemPrompt = buildSystemPrompt(personalInfo, answerSettings, setup);
  const maxTokens = TOKEN_LIMITS[answerSettings?.answerLength] || TOKEN_LIMITS.medium;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-(answerSettings?.memoryLimit || 10)),
    { role: 'user', content: question },
  ];

  const stream = await client.chat.completions.create({
    model: getAnswerModel(selectedProvider),
    messages,
    stream: true,
    max_tokens: maxTokens,
  });

  return stream;
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
  const client = getClient(selectedProvider);
  const sensitivityPrompts = {
    low: 'Only return true if there is a very clear, explicit question with a question mark.',
    medium: 'Return true for clear questions and reasonably implied questions.',
    high: 'Return true for explicit questions, implicit questions, and subtle prompts like "tell me about..." or "walk me through..."',
  };

  const response = await client.chat.completions.create({
    model: getDetectModel(selectedProvider),
    messages: [
      {
        role: 'user',
        content: `Transcript: "${transcript}"\n\n${sensitivityPrompts[sensitivity] || sensitivityPrompts.medium}\n\nReturn valid JSON only: {"isQuestion": boolean, "question": "extracted question or null"}`,
      },
    ],
    max_tokens: 150,
  });

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
  buildSystemPrompt,
  normalizeProvider,
  isProviderConfigured,
  isConfigured,
};
