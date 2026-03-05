'use strict';

// This file uses a separate jest.mock with a tiny AI_TRANSCRIBE_MAX_BYTES so that the
// actual /transcribe-chunk route can be exercised with a multer file-size limit of 10 bytes,
// allowing the LIMIT_FILE_SIZE → 413 path to be tested through the real route handler.
jest.mock('../services/openai.service', () => ({
  generateAnswer: jest.fn(),
  detectQuestion: jest.fn(),
  transcribeAudioChunk: jest.fn(),
  getProviderCooldownRemainingMs: jest.fn(() => 30_000),
  normalizeProvider: jest.fn((p) => p || 'openai'),
  normalizeTranscribeProvider: jest.fn((p) => p || 'openai'),
  isProviderConfigured: jest.fn(() => true),
  isTranscribeProviderConfigured: jest.fn(() => true),
  AI_TRANSCRIBE_MAX_BYTES: 10,
}));

const express = require('express');
const request = require('supertest');
const aiRouter = require('../routes/ai');

describe('AI transcribe chunk route - multer file size limit', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);
  });

  it('returns 413 with a clear error when the uploaded chunk exceeds the configured size limit', async () => {
    const res = await request(app)
      .post('/api/ai/transcribe-chunk')
      .field('provider', 'openai')
      .attach('audio', Buffer.alloc(20), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toContain('exceeds the maximum allowed size');
  });
});
