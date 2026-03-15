import {
  buildManualQuestionFromEntries,
  extractManualQuestionFromTranscript,
  getTranscriptTail,
  buildSessionExportText,
  guessSpeakerLabel,
  normalizeRecognitionLanguages,
  sanitizeTranscriptSegment,
  speakerFromSourceMode,
} from './interviewTranscript';

describe('extractManualQuestionFromTranscript', () => {
  it('returns empty string for empty transcript', () => {
    expect(extractManualQuestionFromTranscript('')).toBe('');
  });

  it('returns last non-empty line for statement transcript', () => {
    const transcript = 'Hello\nI worked on payments platform\n';
    expect(extractManualQuestionFromTranscript(transcript)).toBe('I worked on payments platform');
  });

  it('extracts question line with Chinese question mark', () => {
    const transcript = '上一句\n请介绍一下你自己？';
    expect(extractManualQuestionFromTranscript(transcript)).toBe('请介绍一下你自己？');
  });

  it('extracts question line with english question mark', () => {
    const transcript = 'Tell me about your biggest challenge?';
    expect(extractManualQuestionFromTranscript(transcript)).toBe('Tell me about your biggest challenge?');
  });
});

describe('getTranscriptTail', () => {
  it('returns entire transcript when short', () => {
    expect(getTranscriptTail('hello world', 20)).toBe('hello world');
  });

  it('returns trailing content when transcript exceeds max chars', () => {
    expect(getTranscriptTail('1234567890', 4)).toBe('7890');
  });
});

describe('buildManualQuestionFromEntries', () => {
  it('builds prompt from the latest transcript entries only', () => {
    const result = buildManualQuestionFromEntries([
      { text: 'line 1' },
      { text: 'line 2' },
      { text: 'line 3' },
      { text: 'line 4?' },
    ], { maxEntries: 2, maxChars: 100 });
    expect(result).toBe('line 4?');
  });

  it('returns empty when entries are missing', () => {
    expect(buildManualQuestionFromEntries([])).toBe('');
  });
});

describe('buildSessionExportText', () => {
  it('includes transcript and QA sections', () => {
    const content = buildSessionExportText({
      transcript: 'Interviewer: Hello\nCandidate: Hi',
      completedTurns: [{ question: 'Q1', answer: 'A1' }],
      metadata: { topic: 'behavioral', answerLang: 'en-US', interviewLangs: ['en-US', 'zh-CN'] },
    });

    expect(content).toContain('=== Full Transcript ===');
    expect(content).toContain('Interviewer: Hello');
    expect(content).toContain('=== Q&A ===');
    expect(content).toContain('Q: Q1');
    expect(content).toContain('A: A1');
    expect(content).toContain('Interview Languages: en-US, zh-CN');
  });

  it('prefers structured transcript entries when provided', () => {
    const content = buildSessionExportText({
      transcript: 'fallback transcript',
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Interviewer', language: 'zh-CN', text: '请介绍一下你自己？' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Interviewer] [zh-CN] 请介绍一下你自己？');
    expect(content).not.toContain('fallback transcript');
  });
});

describe('guessSpeakerLabel', () => {
  it('marks question-like text as interviewer', () => {
    expect(guessSpeakerLabel('Can you tell me about your project?')).toBe('Interviewer');
    expect(guessSpeakerLabel('请介绍一下你自己')).toBe('Interviewer');
  });

  it('marks non-question statement as candidate', () => {
    expect(guessSpeakerLabel('I led the migration to microservices')).toBe('Candidate');
  });
});

describe('normalizeRecognitionLanguages', () => {
  it('normalizes and de-duplicates language list', () => {
    expect(normalizeRecognitionLanguages(['en-US', 'zh-CN', 'en-US'])).toEqual(['en-US', 'zh-CN']);
  });

  it('falls back to en-US when no valid values', () => {
    expect(normalizeRecognitionLanguages(['', '   '])).toEqual(['en-US']);
  });
});

describe('sanitizeTranscriptSegment', () => {
  it('removes subtitle watermark snippets', () => {
    expect(sanitizeTranscriptSegment('字幕by索兰娅 你好')).toBe('你好');
    expect(sanitizeTranscriptSegment('字幕制作人Zither Harp 你好')).toBe('你好');
    expect(sanitizeTranscriptSegment('captions by someone hello')).toBe('hello');
  });

  it('returns empty when text is only a watermark', () => {
    expect(sanitizeTranscriptSegment('字幕 by 索兰娅')).toBe('');
  });

  it('filters common video outro noise', () => {
    expect(sanitizeTranscriptSegment('感谢观看')).toBe('');
    expect(sanitizeTranscriptSegment('别忘了订阅')).toBe('');
  });

  it('filters browser chrome noise text', () => {
    expect(sanitizeTranscriptSegment('Address and search bar')).toBe('');
    expect(sanitizeTranscriptSegment('search or type url')).toBe('');
    expect(sanitizeTranscriptSegment('地址和搜索栏')).toBe('');
    expect(sanitizeTranscriptSegment('Ready to show live captions in Chinese (Simplified, Mainland China)')).toBe('');
    expect(sanitizeTranscriptSegment('LiveCaptions-Translator/src/utils at master · SakiRinn/LiveCaptions-Translator')).toBe('');
    expect(sanitizeTranscriptSegment('Change language')).toBe('');
    expect(sanitizeTranscriptSegment('Include microphone audio')).toBe('');
    expect(sanitizeTranscriptSegment('Change language Include microphone audio')).toBe('');
  });

  it('keeps normal interview text', () => {
    expect(sanitizeTranscriptSegment('面试官你好')).toBe('面试官你好');
  });

  it('collapses long repeated fragments', () => {
    expect(
      sanitizeTranscriptSegment('因为我觉得我们课程很便宜因为我觉得我们课程很便宜'),
    ).toBe('因为我觉得我们课程很便宜');
  });
});

describe('speakerFromSourceMode', () => {
  it('maps system to interviewer and mic to candidate', () => {
    expect(speakerFromSourceMode('system')).toBe('Interviewer');
    expect(speakerFromSourceMode('mic')).toBe('Candidate');
  });

  it('returns unknown for unsupported modes', () => {
    expect(speakerFromSourceMode('mic-system')).toBe('Unknown');
  });
});
