'use strict';

jest.mock('../services/openai.service', () => ({
  generateAnswer: jest.fn(),
  detectQuestion: jest.fn(),
  transcribeAudioChunk: jest.fn(),
  getProviderCooldownRemainingMs: jest.fn(() => 30_000),
  normalizeProvider: jest.fn((provider) => provider || 'openai'),
  normalizeTranscribeProvider: jest.fn((provider) => provider || 'openai'),
  isProviderConfigured: jest.fn(() => true),
  isTranscribeProviderConfigured: jest.fn(() => true),
  AI_TRANSCRIBE_MAX_BYTES: 5 * 1024 * 1024,
}));

const express = require('express');
const request = require('supertest');
const aiRouter = require('../routes/ai');
const {
  generateAnswer,
  getProviderCooldownRemainingMs,
  isProviderConfigured,
  isTranscribeProviderConfigured,
  normalizeProvider,
  normalizeTranscribeProvider,
  transcribeAudioChunk,
} = require('../services/openai.service');

describe('AI answer streaming route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    isProviderConfigured.mockReturnValue(true);
    normalizeProvider.mockImplementation((provider) => provider || 'openai');
    getProviderCooldownRemainingMs.mockReturnValue(30_000);
  });

  it('streams answer chunks and terminates with done event', async () => {
    async function* mockAnswerStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
      yield { choices: [{ delta: { content: '' } }] };
    }
    generateAnswer.mockResolvedValue(mockAnswerStream());

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"text":"Hello"}\n\n');
    expect(res.text).toContain('data: {"text":" world"}\n\n');
    expect(res.text).toContain('data: {"done":true}\n\n');
    expect(res.text).not.toContain('"error"');
  });

  it('streams a generic error without leaking internal details', async () => {
    generateAnswer.mockRejectedValue(new Error('OpenAI token invalid: sk-abc-secret'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"error":"Failed to start answer generation"}\n\n');
    expect(res.text).not.toContain('OpenAI token invalid');
    expect(errorSpy).toHaveBeenCalledWith(
      '[AI answer] stream init error:',
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it('streams a rate-limit error message with cooldown guidance', async () => {
    const rateLimitErr = Object.assign(new Error('Rate limit exceeded'), {
      status: 429,
      provider: 'openai',
      retryAfterMs: 35_000,
    });
    generateAnswer.mockRejectedValue(rateLimitErr);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Rate limit reached for openai');
    expect(res.text).toContain('Wait about 35s');
    expect(res.text).toContain('switch AI Provider');
    expect(errorSpy).toHaveBeenCalledWith(
      '[AI answer] stream init error:',
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it('streams a provider-specific message when Gemini returns HTTP 400', async () => {
    normalizeProvider.mockReturnValue('gemini');
    const badRequestErr = Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 });
    generateAnswer.mockRejectedValue(badRequestErr);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself', provider: 'gemini' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"error":"Gemini rejected this request (400). Check your request parameters and Gemini configuration (e.g., GEMINI_MODEL, GEMINI_API_KEY) and try again."}\n\n');
    expect(errorSpy).toHaveBeenCalledWith(
      '[AI answer] stream init error:',
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it('returns 503 with key hint when selected provider is not configured', async () => {
    normalizeProvider.mockReturnValue('gemini');
    isProviderConfigured.mockReturnValue(false);

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself', provider: 'gemini' });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('gemini');
    expect(res.body.error).toContain('GEMINI_API_KEY');
    expect(generateAnswer).not.toHaveBeenCalled();
  });

  it('fails over to the other provider when the selected provider returns 429', async () => {
    normalizeProvider.mockImplementation((provider) => provider || 'gemini');
    const rateLimitErr = Object.assign(new Error('Rate limit exceeded'), {
      status: 429,
      provider: 'gemini',
    });

    async function* fallbackStream() {
      yield { choices: [{ delta: { content: 'fallback answer' } }] };
    }

    generateAnswer
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(fallbackStream());

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself', provider: 'gemini' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('fallback answer');
    expect(res.text).toContain('data: {"done":true}\n\n');
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(generateAnswer.mock.calls[0][0].provider).toBe('gemini');
    expect(generateAnswer.mock.calls[1][0].provider).toBe('openai');
  });

  it('clips oversized question payload before calling provider', async () => {
    async function* stream() {
      yield { choices: [{ delta: { content: 'ok' } }] };
    }
    generateAnswer.mockResolvedValue(stream());
    const longQuestion = `head-${'x'.repeat(2200)}-tail`;

    await request(app)
      .post('/api/ai/answer')
      .send({ question: longQuestion, provider: 'openai' });

    const questionSent = generateAnswer.mock.calls[0][0].question;
    expect(questionSent.length).toBeLessThanOrEqual(1600);
    expect(questionSent.endsWith('-tail')).toBe(true);
  });
});

describe('AI transcribe chunk route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    normalizeProvider.mockImplementation((provider) => provider || 'openai');
    normalizeTranscribeProvider.mockImplementation((provider) => provider || 'openai');
    isTranscribeProviderConfigured.mockReturnValue(true);
  });

  it('returns 400 when chunk is missing', async () => {
    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'openai');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('audio chunk is required');
  });

  it('returns transcribed text for uploaded chunk', async () => {
    transcribeAudioChunk.mockResolvedValue('hello interviewer');
    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'openai')
      .field('language', 'en-US')
      .field('sourceMode', 'mic-system')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('hello interviewer');
    expect(res.body.sourceMode).toBe('mic-system');
    expect(transcribeAudioChunk).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      mimeType: 'audio/webm',
      languageHint: 'en-US',
      audioBuffer: expect.any(Buffer),
    }));
  });

  it('honors explicit transcribeProvider when provided', async () => {
    transcribeAudioChunk.mockResolvedValue('ni hao');
    await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'openai')
      .field('transcribeProvider', 'gemini')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.ogg',
        contentType: 'audio/ogg',
      });

    expect(transcribeAudioChunk).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      mimeType: 'audio/ogg',
      audioBuffer: expect.any(Buffer),
    }));
  });

  it('system stream with explicit local honors explicit provider', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => provider === 'local');
    transcribeAudioChunk.mockResolvedValue('local transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'local')
      .field('sourceMode', 'system')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(transcribeAudioChunk).toHaveBeenCalledTimes(1);
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: 'local',
      sourceMode: 'system',
    }));
  });

  it('falls through to next provider when current provider returns empty text', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => (
      provider === 'windows-live-captions' || provider === 'local'
    ));
    transcribeAudioChunk
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('fallback transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .field('sourceMode', 'system')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('fallback transcript');
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: 'local',
      sourceMode: 'system',
    }));
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: 'windows-live-captions',
      sourceMode: 'system',
    }));
  });

  it('auto-falls back to local transcribe provider when cloud providers are unavailable', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => provider === 'local');
    transcribeAudioChunk.mockResolvedValue('local transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(transcribeAudioChunk).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'local',
      mimeType: 'audio/webm',
    }));
  });

  it('auto prefers openai over local/gemini when openai is configured', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => (
      provider === 'openai' || provider === 'local' || provider === 'gemini'
    ));
    transcribeAudioChunk.mockResolvedValue('openai transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(transcribeAudioChunk).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      mimeType: 'audio/webm',
    }));
  });

  it('auto falls back to windows-live-captions for system source when cloud/local are unavailable', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => provider === 'windows-live-captions');
    transcribeAudioChunk.mockResolvedValue('system transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .field('sourceMode', 'system')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(transcribeAudioChunk).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'windows-live-captions',
      sourceMode: 'system',
    }));
  });

  it('auto failovers to local when openai transcription is unavailable at runtime', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => (
      provider === 'openai' || provider === 'local' || provider === 'gemini'
    ));
    transcribeAudioChunk
      .mockRejectedValueOnce(Object.assign(new Error('openai unavailable'), { status: 503 }))
      .mockResolvedValueOnce('local transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('local transcript');
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: 'openai',
      mimeType: 'audio/webm',
    }));
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: 'local',
      mimeType: 'audio/webm',
    }));
  });

  it('auto failovers to gemini when local transcription is unavailable at runtime', async () => {
    isTranscribeProviderConfigured.mockImplementation((provider) => (
      provider === 'local' || provider === 'gemini'
    ));
    transcribeAudioChunk
      .mockRejectedValueOnce(Object.assign(new Error('local down'), { status: 503 }))
      .mockResolvedValueOnce('gemini transcript');

    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('transcribeProvider', 'auto')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('gemini transcript');
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: 'local',
      mimeType: 'audio/webm',
    }));
    expect(transcribeAudioChunk).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: 'gemini',
      mimeType: 'audio/webm',
    }));
  });

  it('returns 429 with cooldown guidance for transcription rate limit', async () => {
    transcribeAudioChunk.mockRejectedValue(Object.assign(
      new Error('rate limited'),
      { status: 429, provider: 'openai', retryAfterMs: 12_000 }
    ));
    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'openai')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Wait about 12s');
  });

  it('returns 503 message when transcription provider is not configured', async () => {
    transcribeAudioChunk.mockRejectedValue(Object.assign(
      new Error('Audio transcription requires GEMINI_API_KEY.'),
      { status: 503, provider: 'gemini' }
    ));
    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'gemini')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'chunk.ogg',
        contentType: 'audio/ogg',
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('GEMINI_API_KEY');
  });
});
