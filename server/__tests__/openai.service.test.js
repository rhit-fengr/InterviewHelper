'use strict';

const { buildSystemPrompt, isConfigured } = require('../services/openai.service');

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
