import { normalizeQuestionKey, shouldSkipAutoAnswer } from './autoAnswer';

describe('autoAnswer', () => {
  it('normalizes punctuation and spacing when building question key', () => {
    expect(normalizeQuestionKey('  Tell me about yourself?  ')).toBe('tell me about yourself');
    expect(normalizeQuestionKey('你 好  吗？')).toBe('你 好 吗');
    expect(normalizeQuestionKey('How, are: you!!')).toBe('how are you');
  });

  it('skips when question is empty', () => {
    expect(shouldSkipAutoAnswer({ question: '' })).toBe(true);
    expect(shouldSkipAutoAnswer({ question: '   ' })).toBe(true);
  });

  it('skips duplicate pending question while loading', () => {
    expect(shouldSkipAutoAnswer({
      question: 'Tell me about yourself?',
      pendingQuestion: 'Tell me about yourself',
      isLoading: true,
    })).toBe(true);
  });

  it('skips duplicate question during dedupe window', () => {
    const now = 100_000;
    expect(shouldSkipAutoAnswer({
      question: 'Why do you want to join us?',
      lastAuto: { key: 'why do you want to join us', at: now - 5_000 },
      now,
      dedupeWindowMs: 30_000,
    })).toBe(true);
  });

  it('allows same question after dedupe window has passed', () => {
    const now = 100_000;
    expect(shouldSkipAutoAnswer({
      question: 'Why do you want to join us?',
      lastAuto: { key: 'why do you want to join us', at: now - 40_000 },
      now,
      dedupeWindowMs: 30_000,
    })).toBe(false);
  });

  it('allows different question even during cooldown', () => {
    const now = 100_000;
    expect(shouldSkipAutoAnswer({
      question: 'What is your biggest strength?',
      lastAuto: { key: 'why do you want to join us', at: now - 5_000 },
      now,
      dedupeWindowMs: 30_000,
    })).toBe(false);
  });
});
