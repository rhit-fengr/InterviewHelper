'use strict';

const {
  buildSystemPrompt,
  isConfigured,
  normalizeProvider,
  normalizeTranscribeProvider,
  isProviderConfigured,
  isTranscribeProviderConfigured,
  transcribeAudioChunk,
} = require('../services/openai.service');

describe('buildSystemPrompt', () => {
  it('includes candidate name', () => {
    const prompt = buildSystemPrompt({ fullName: 'Alice' }, {}, { topic: 'behavioral' });
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('behavioral');
  });

  it('handles missing personalInfo gracefully', () => {
    const prompt = buildSystemPrompt({}, {}, {});
    expect(prompt).toContain('the candidate');
    expect(prompt).toContain('general');
  });

  it('includes behavioral structure', () => {
    const prompt = buildSystemPrompt({}, { behavioralStructure: 'CAR' }, {});
    expect(prompt).toContain('CAR');
  });

  it('includes answer language', () => {
    const prompt = buildSystemPrompt({}, {}, { answerLang: 'zh-CN' });
    expect(prompt).toContain('zh-CN');
  });
});

describe('isConfigured', () => {
  it('is false when OPENAI_API_KEY env var is not set', () => {
    // Tests run without the env var, so the service should report unconfigured
    expect(isConfigured).toBe(false);
  });
});

describe('provider helpers', () => {
  it('normalizes unknown provider to default openai', () => {
    expect(normalizeProvider('unknown-provider')).toBe('openai');
    expect(normalizeProvider('gemini')).toBe('gemini');
  });

  it('normalizes unknown transcribe provider to default openai', () => {
    expect(normalizeTranscribeProvider('unknown-provider')).toBe('openai');
    expect(normalizeTranscribeProvider('local')).toBe('local');
  });

  it('reports gemini provider as unconfigured when GEMINI_API_KEY is not set', () => {
    expect(isProviderConfigured('gemini')).toBe(false);
  });

  it('reports local transcribe provider as unconfigured when LOCAL_TRANSCRIBE_URL is not set', () => {
    expect(isTranscribeProviderConfigured('local')).toBe(false);
  });
});

describe('transcribeAudioChunk', () => {
  it('throws 400 when audioBuffer is not a Buffer', async () => {
    await expect(transcribeAudioChunk({ provider: 'openai', audioBuffer: null }))
      .rejects.toMatchObject({ status: 400, message: 'audio chunk is required' });
  });

  it('throws 400 when audioBuffer is empty', async () => {
    await expect(transcribeAudioChunk({ provider: 'openai', audioBuffer: Buffer.alloc(0) }))
      .rejects.toMatchObject({ status: 400, message: 'audio chunk is required' });
  });

  it('throws 503 when openai provider is not configured (no OPENAI_API_KEY)', async () => {
    // Tests run without OPENAI_API_KEY set
    await expect(
      transcribeAudioChunk({ provider: 'openai', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining('OPENAI_API_KEY') });
  });

  it('throws 503 when local provider is not configured (no LOCAL_TRANSCRIBE_URL)', async () => {
    // Tests run without LOCAL_TRANSCRIBE_URL set
    await expect(
      transcribeAudioChunk({ provider: 'local', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining('LOCAL_TRANSCRIBE_URL') });
  });

  it('throws 503 when gemini provider is not configured (no GEMINI_API_KEY)', async () => {
    // Tests run without GEMINI_API_KEY set
    await expect(
      transcribeAudioChunk({ provider: 'gemini', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining('GEMINI_API_KEY') });
  });

  it('throws 413 when audioBuffer exceeds AI_TRANSCRIBE_MAX_BYTES', async () => {
    // Reload the module with a tiny limit so we can test the 413 branch without allocating 5 MB
    jest.resetModules();
    const originalEnv = process.env.AI_TRANSCRIBE_MAX_BYTES;
    process.env.AI_TRANSCRIBE_MAX_BYTES = '10';
    try {
      const { transcribeAudioChunk: fn } = require('../services/openai.service');
      await expect(fn({ provider: 'openai', audioBuffer: Buffer.alloc(20) }))
        .rejects.toMatchObject({ status: 413, message: expect.stringContaining('exceeds max size') });
    } finally {
      process.env.AI_TRANSCRIBE_MAX_BYTES = originalEnv;
      jest.resetModules();
    }
  });

  it('uses default 5 MB limit when AI_TRANSCRIBE_MAX_BYTES is non-numeric', async () => {
    jest.resetModules();
    const originalEnv = process.env.AI_TRANSCRIBE_MAX_BYTES;
    process.env.AI_TRANSCRIBE_MAX_BYTES = 'not-a-number';
    try {
      const { transcribeAudioChunk: fn } = require('../services/openai.service');
      // A small buffer should not hit the 413 branch (default limit is 5 MB)
      await expect(fn({ provider: 'openai', audioBuffer: Buffer.alloc(10) }))
        .rejects.toMatchObject({ status: 503 }); // 503: no OPENAI_API_KEY — not 413
    } finally {
      process.env.AI_TRANSCRIBE_MAX_BYTES = originalEnv;
      jest.resetModules();
    }
  });

  it('returns transcript from local provider via mocked fetch', async () => {
    jest.resetModules();
    const originalUrl = process.env.LOCAL_TRANSCRIBE_URL;
    process.env.LOCAL_TRANSCRIBE_URL = 'http://localhost:9999/transcribe';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'local transcript result' }),
    });
    try {
      const { transcribeAudioChunk: fn } = require('../services/openai.service');
      const result = await fn({ provider: 'local', audioBuffer: Buffer.from('audio-data'), mimeType: 'audio/webm' });
      expect(result).toBe('local transcript result');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9999/transcribe',
        expect.objectContaining({ method: 'POST' })
      );
    } finally {
      process.env.LOCAL_TRANSCRIBE_URL = originalUrl;
      jest.resetModules();
      delete global.fetch;
    }
  });

  it('returns transcript from gemini provider via mocked fetch', async () => {
    jest.resetModules();
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'gemini transcript' }] } }],
      }),
    });
    try {
      const { transcribeAudioChunk: fn } = require('../services/openai.service');
      const result = await fn({ provider: 'gemini', audioBuffer: Buffer.from('audio-data'), mimeType: 'audio/webm' });
      expect(result).toBe('gemini transcript');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generateContent'),
        expect.objectContaining({ method: 'POST' })
      );
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
      jest.resetModules();
      delete global.fetch;
    }
  });

  it('throws 429 and marks provider on cooldown when local returns 429', async () => {
    jest.resetModules();
    const originalUrl = process.env.LOCAL_TRANSCRIBE_URL;
    process.env.LOCAL_TRANSCRIBE_URL = 'http://localhost:9999/transcribe';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    });
    try {
      const { transcribeAudioChunk: fn } = require('../services/openai.service');
      await expect(fn({ provider: 'local', audioBuffer: Buffer.from('data'), mimeType: 'audio/webm' }))
        .rejects.toMatchObject({ status: 429 });
    } finally {
      process.env.LOCAL_TRANSCRIBE_URL = originalUrl;
      jest.resetModules();
      delete global.fetch;
    }
  });
});
