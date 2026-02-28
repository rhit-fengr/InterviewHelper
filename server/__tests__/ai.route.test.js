'use strict';

jest.mock('../services/openai.service', () => ({
  generateAnswer: jest.fn(),
  detectQuestion: jest.fn(),
  normalizeProvider: jest.fn((provider) => provider || 'openai'),
  isProviderConfigured: jest.fn(() => true),
}));

const express = require('express');
const request = require('supertest');
const aiRouter = require('../routes/ai');
const {
  generateAnswer,
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

  it('streams a rate-limit error message when OpenAI returns HTTP 429', async () => {
    const rateLimitErr = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    generateAnswer.mockRejectedValue(rateLimitErr);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"error":"Rate limit reached. Please wait a moment and try again."}\n\n');
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
    expect(res.text).toContain('data: {"error":"Gemini rejected this request (400). Check GEMINI_MODEL/GEMINI_API_KEY and try again."}\n\n');
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
});
