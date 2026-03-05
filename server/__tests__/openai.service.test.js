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

describe('transcribeAudioChunk - validation', () => {
  it('throws 400 when audioBuffer is empty', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'openai', audioBuffer: Buffer.alloc(0) })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when audioBuffer is not a Buffer', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'openai', audioBuffer: 'not-a-buffer' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when audioBuffer is null', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'openai', audioBuffer: null })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 503 when openai provider is not configured', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'openai', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when gemini provider is not configured', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'gemini', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when local provider URL is not set', async () => {
    await expect(
      transcribeAudioChunk({ provider: 'local', audioBuffer: Buffer.from('data') })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('transcribeAudioChunk - size limit', () => {
  let fn;

  beforeAll(() => {
    process.env.AI_TRANSCRIBE_MAX_BYTES = '10';
    jest.isolateModules(() => {
      fn = require('../services/openai.service').transcribeAudioChunk;
    });
    delete process.env.AI_TRANSCRIBE_MAX_BYTES;
  });

  it('throws 413 when audioBuffer exceeds the configured max bytes', async () => {
    await expect(
      fn({ provider: 'openai', audioBuffer: Buffer.alloc(20) })
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe('transcribeAudioChunk - local provider', () => {
  let fn;
  let originalFetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    process.env.LOCAL_TRANSCRIBE_URL = 'http://127.0.0.1:9999/transcribe';
    jest.isolateModules(() => {
      fn = require('../services/openai.service').transcribeAudioChunk;
    });
    delete process.env.LOCAL_TRANSCRIBE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls local service and returns transcribed text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'local transcription result' }),
    });

    const result = await fn({
      provider: 'local',
      audioBuffer: Buffer.from('audio-data'),
      mimeType: 'audio/webm',
    });

    expect(result).toBe('local transcription result');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/transcribe',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws with the upstream status when local service returns a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'service unavailable' }),
    });

    await expect(
      fn({ provider: 'local', audioBuffer: Buffer.from('audio-data') })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('transcribeAudioChunk - Gemini provider', () => {
  let fn;
  let originalFetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    jest.isolateModules(() => {
      fn = require('../services/openai.service').transcribeAudioChunk;
    });
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls Gemini API and returns transcribed text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'gemini transcription result' }] } }],
      }),
    });

    const result = await fn({
      provider: 'gemini',
      audioBuffer: Buffer.from('audio-data'),
      mimeType: 'audio/webm',
    });

    expect(result).toBe('gemini transcription result');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws 502 when Gemini returns an empty transcription', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] } }] }),
    });

    await expect(
      fn({ provider: 'gemini', audioBuffer: Buffer.from('audio-data') })
    ).rejects.toMatchObject({ status: 502 });
  });

  // 429 test last: marks the provider on cooldown, affecting subsequent calls in this module instance
  it('throws 429 and marks provider on cooldown when Gemini returns rate limit error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'quota exceeded' } }),
    });

    await expect(
      fn({ provider: 'gemini', audioBuffer: Buffer.from('audio-data') })
    ).rejects.toMatchObject({ status: 429, provider: 'gemini' });
  });
});
