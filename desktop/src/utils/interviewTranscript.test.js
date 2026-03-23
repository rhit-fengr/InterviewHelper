import {
  buildManualQuestionFromEntries,
  extractManualQuestionFromTranscript,
  getTranscriptTail,
  buildSessionExportText,
  guessSpeakerLabel,
  normalizeRecognitionLanguages,
  sanitizeTranscriptSegment,
  speakerFromSourceMode,
  formatSourceLabel,
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
        { timestamp: 1700000000000, speaker: 'Interviewer', source: 'system', language: 'zh-CN', text: '请介绍一下你自己？' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Interviewer] [SYSTEM] [zh-CN] 请介绍一下你自己？');
    expect(content).not.toContain('fallback transcript');
  });

  it('includes source label (MIC) for candidate entries', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Candidate', source: 'mic', language: 'en-US', text: 'I led the migration.' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Candidate] [MIC] [en-US] I led the migration.');
  });

  it('includes source label (SYSTEM) for interviewer entries', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Interviewer', source: 'system', language: 'en-US', text: 'Tell me about that.' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Interviewer] [SYSTEM] [en-US] Tell me about that.');
  });

  it('uses MIXED label for mixed audio source', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Candidate', source: 'mic-system', language: 'en-US', text: 'Something overlapped.' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Candidate] [MIXED] [en-US] Something overlapped.');
  });

  it('uses UNKNOWN label when source is missing', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Candidate', language: 'en-US', text: 'No source provided.' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Candidate] [UNKNOWN] [en-US] No source provided.');
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

describe('sanitizeTranscriptSegment - WLC menu noise in embedded contexts', () => {
  it('removes standalone WLC menu items (anchored patterns)', () => {
    // These are handled by TRANSCRIPT_NOISE_ONLY_PATTERNS (anchored to start)
    expect(sanitizeTranscriptSegment('Change language')).toBe('');
    expect(sanitizeTranscriptSegment('Include microphone audio')).toBe('');
    expect(sanitizeTranscriptSegment('Change language Include microphone audio')).toBe('');
  });

  it('removes "Ready to show live captions" system messages', () => {
    expect(sanitizeTranscriptSegment('Ready to show live captions in English')).toBe('');
    expect(sanitizeTranscriptSegment('Ready to show live captions in Spanish (Spain)')).toBe('');
    expect(sanitizeTranscriptSegment('Ready to show live captions in French (France)')).toBe('');
  });

  it('removes "Address and search bar" UI element when standalone', () => {
    expect(sanitizeTranscriptSegment('Address and search bar')).toBe('');
    expect(sanitizeTranscriptSegment('address and search bar')).toBe('');
  });

  it('removes standalone "Caption" or "Captions" labels', () => {
    expect(sanitizeTranscriptSegment('Caption')).toBe('');
    expect(sanitizeTranscriptSegment('Captions')).toBe('');
    expect(sanitizeTranscriptSegment('captions')).toBe('');
  });

  it('removes Chinese/Simplified menu equivalents when standalone', () => {
    // These are in TRANSCRIPT_NOISE_ONLY_PATTERNS
    expect(sanitizeTranscriptSegment('更改语言')).toBe('');
    expect(sanitizeTranscriptSegment('包括麦克风音频')).toBe('');
  });

  it('removes standalone other-language labels from patterns', () => {
    // These patterns are part of TRANSCRIPT_NOISE_ONLY_PATTERNS
    expect(sanitizeTranscriptSegment('ready to show live captions in Chinese (Simplified, Mainland China)')).toBe('');
  });

  it('filters subtitle watermarks with creator names', () => {
    // TRANSCRIPT_NOISE_PATTERNS handle these
    expect(sanitizeTranscriptSegment('字幕 by 索兰娅')).toBe('');
    expect(sanitizeTranscriptSegment('字幕制作人 Zither Harp')).toBe('');
    expect(sanitizeTranscriptSegment('captions by UserName hello')).toBe('hello');
  });

  it('removes livecaptions-translator path when present', () => {
    // Pattern: /livecaptions-translator\/[^\s]+/gi
    expect(sanitizeTranscriptSegment('livecaptions-translator/src/utils')).toBe('');
  });

  it('preserves subtitle watermarks with meaningful content', () => {
    // Watermark + content should keep the content
    expect(sanitizeTranscriptSegment('字幕 by 索兰娅 你好')).toBe('你好');
    expect(sanitizeTranscriptSegment('字幕制作人 Zither Harp 你好')).toBe('你好');
    expect(sanitizeTranscriptSegment('captions by someone hello')).toBe('hello');
  });

  it('keeps real interview questions that mention language features', () => {
    // Ensure we don't over-filter legitimate content
    expect(sanitizeTranscriptSegment('Can you change language settings on your system?')).toBe('Can you change language settings on your system?');
    expect(sanitizeTranscriptSegment('Tell me about include patterns in your code?')).toBe('Tell me about include patterns in your code?');
  });

  it('filters common video outro noise (Chinese and English)', () => {
    expect(sanitizeTranscriptSegment('感谢观看')).toBe('');
    expect(sanitizeTranscriptSegment('別忘了訂閱')).toBe('');
    expect(sanitizeTranscriptSegment('like and subscribe')).toBe('');
  });

  it('filters browser UI text when appearing as noise', () => {
    expect(sanitizeTranscriptSegment('search or type url')).toBe('');
    expect(sanitizeTranscriptSegment('search bar')).toBe('');
  });

  it('handles address/search bar pattern variations', () => {
    expect(sanitizeTranscriptSegment('address bar')).toBe('');
    expect(sanitizeTranscriptSegment('地址和搜索栏')).toBe('');
    expect(sanitizeTranscriptSegment('地址列')).toBe('');
    expect(sanitizeTranscriptSegment('搜索栏')).toBe('');
  });

  it('removes repository paths that mention livecaptions', () => {
    const githubPath = 'livecaptions-translator/src/utils';
    expect(sanitizeTranscriptSegment(githubPath)).toBe('');
  });

  it('collapses repeated substrings in normal text', () => {
    // The collapse algorithm helps with repeated fragments
    // Note: 'good good good' is 12 chars, which is within the collapse threshold
    const repeated = 'I think the approach is good the approach is good';
    const result = sanitizeTranscriptSegment(repeated);
    // Should collapse when unit reaches threshold
    expect(result.length).toBeLessThan(repeated.length);
  });

  it('handles "at master" with livecaptions repository path', () => {
    // Pattern catches: .*\bat master\b.*livecaptions-translator.*
    expect(sanitizeTranscriptSegment('at master livecaptions-translator')).toBe('');
  });

  it('integration: keeps meaningful content with noise', () => {
    // When there's real content mixed with standalone noise patterns
    const mixed = 'I have experience. caption here hello world';
    const result = sanitizeTranscriptSegment(mixed);
    expect(result).toContain('I have experience');
    expect(result).toContain('hello world');
    // "caption" might not be fully removed if it's not in a noise-only position
    // The important thing is we preserve meaningful content
    expect(result).toBeTruthy();
  });

  it('handles watermarks that leave remaining content', () => {
    expect(sanitizeTranscriptSegment('字幕由SomePerson制作 你好')).toBe('你好');
  });

  it('removes Chinese traditional watermark patterns', () => {
    expect(sanitizeTranscriptSegment('字幕製作人 creator')).toBe('');
  });
});

describe('formatSourceLabel', () => {
  it('formats mic source to MIC label', () => {
    expect(formatSourceLabel('mic')).toBe('MIC');
    expect(formatSourceLabel('Mic')).toBe('MIC');
    expect(formatSourceLabel('MIC')).toBe('MIC');
    expect(formatSourceLabel('  mic  ')).toBe('MIC');
  });

  it('formats system source to SYSTEM label', () => {
    expect(formatSourceLabel('system')).toBe('SYSTEM');
    expect(formatSourceLabel('System')).toBe('SYSTEM');
    expect(formatSourceLabel('SYSTEM')).toBe('SYSTEM');
    expect(formatSourceLabel('  system  ')).toBe('SYSTEM');
  });

  it('formats mixed source to MIXED label', () => {
    expect(formatSourceLabel('mic-system')).toBe('MIXED');
    expect(formatSourceLabel('Mic-System')).toBe('MIXED');
    expect(formatSourceLabel('MIC-SYSTEM')).toBe('MIXED');
    expect(formatSourceLabel('  mic-system  ')).toBe('MIXED');
  });

  it('returns UNKNOWN for unsupported sources', () => {
    expect(formatSourceLabel('')).toBe('UNKNOWN');
    expect(formatSourceLabel('unknown')).toBe('UNKNOWN');
    expect(formatSourceLabel('invalid')).toBe('UNKNOWN');
    expect(formatSourceLabel(null)).toBe('UNKNOWN');
    expect(formatSourceLabel(undefined)).toBe('UNKNOWN');
  });

  it('correctly maps Candidate/MIC combination', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        {
          timestamp: 1700000000000,
          speaker: 'Candidate',
          source: 'mic',
          language: 'en-US',
          text: 'I have 5 years of experience.',
        },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Candidate] [MIC]');
  });

  it('correctly maps Interviewer/SYSTEM combination', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        {
          timestamp: 1700000000000,
          speaker: 'Interviewer',
          source: 'system',
          language: 'en-US',
          text: 'What is your favorite project?',
        },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Interviewer] [SYSTEM]');
  });

  it('handles multiple entries with mixed sources', () => {
    const content = buildSessionExportText({
      transcriptEntries: [
        { timestamp: 1700000000000, speaker: 'Interviewer', source: 'system', language: 'en-US', text: 'Tell me about yourself?' },
        { timestamp: 1700000001000, speaker: 'Candidate', source: 'mic', language: 'en-US', text: 'I started my career...' },
        { timestamp: 1700000002000, speaker: 'Interviewer', source: 'system', language: 'en-US', text: 'And then?' },
        { timestamp: 1700000003000, speaker: 'Candidate', source: 'mic', language: 'en-US', text: 'I learned a lot.' },
      ],
      completedTurns: [],
      metadata: {},
    });

    expect(content).toContain('[Interviewer] [SYSTEM] [en-US] Tell me about yourself?');
    expect(content).toContain('[Candidate] [MIC] [en-US] I started my career...');
    expect(content).toContain('[Interviewer] [SYSTEM] [en-US] And then?');
    expect(content).toContain('[Candidate] [MIC] [en-US] I learned a lot.');
  });
});
