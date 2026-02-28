'use strict';

jest.mock('../services/openai.service', () => ({
  generateAnswer: jest.fn(),
  detectQuestion: jest.fn(),
  getProviderCooldownRemainingMs: jest.fn(() => 30_000),
  normalizeProvider: jest.fn((provider) => provider || 'openai'),
  isProviderConfigured: jest.fn(() => true),
}));

const express = require('express');
const request = require('supertest');
const aiRouter = require('../routes/ai');
const {
  generateAnswer,
  getProviderCooldownRemainingMs,
  isProviderConfigured,
  normalizeProvider,
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
