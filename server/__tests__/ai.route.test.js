'use strict';

jest.mock('../services/openai.service', () => ({
  generateAnswer: jest.fn(),
  detectQuestion: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const aiRouter = require('../routes/ai');
const { generateAnswer } = require('../services/openai.service');

describe('AI answer streaming route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('streams a generic error without leaking internal details', async () => {
    generateAnswer.mockRejectedValue(new Error('OpenAI token invalid: sk-abc-secret'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: [ERROR] Failed to generate answer. Reference: trace_');
    expect(res.text).not.toContain('OpenAI token invalid');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
