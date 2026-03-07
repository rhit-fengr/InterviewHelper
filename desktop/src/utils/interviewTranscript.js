export function extractManualQuestionFromTranscript(transcript = '') {
  const text = String(transcript || '').trim();
  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : text;

  const questionMarkIndex = Math.max(lastLine.lastIndexOf('?'), lastLine.lastIndexOf('？'));
  if (questionMarkIndex !== -1) {
    return lastLine.slice(0, questionMarkIndex + 1).trim();
  }

  return lastLine;
}

export function getTranscriptTail(transcript = '', maxChars = 1200) {
  const text = String(transcript || '').trim();
  if (!text) return '';
  const limit = Math.max(1, Number(maxChars) || 1200);
  return text.length <= limit ? text : text.slice(-limit).trim();
}

const TRANSCRIPT_NOISE_PATTERNS = [
  /字幕\s*by\s*[A-Za-z0-9_.\-\u4e00-\u9fa5]{1,24}(?:\s+[A-Za-z][A-Za-z0-9_.\-]{0,23})?/gi,
  /字幕制作人(?:\s*[：:])?\s*[A-Za-z0-9_.\-\u4e00-\u9fa5]{1,24}(?:\s+[A-Za-z][A-Za-z0-9_.\-]{0,23})?/gi,
  /字幕製作人(?:\s*[：:])?\s*[A-Za-z0-9_.\-\u4e00-\u9fa5]{1,24}(?:\s+[A-Za-z][A-Za-z0-9_.\-]{0,23})?/gi,
  /caption(?:s)?\s*by\s*[A-Za-z0-9_.\-]{1,24}/gi,
  /字幕由[^\s,，。.!?？]{1,24}(?:提供|制作|製作)?/gi,
];

export function sanitizeTranscriptSegment(text = '') {
  let cleaned = String(text || '').trim();
  if (!cleaned) return '';

  for (const pattern of TRANSCRIPT_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  cleaned = cleaned
    .replace(/^[\s:：\-|,.，。]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';

  // Guard against standalone watermark-like leftovers.
  if (/^(字幕|captions?)(?:\s|$)/i.test(cleaned) && cleaned.length <= 24) {
    return '';
  }

  return cleaned;
}

export function buildManualQuestionFromEntries(entries = [], {
  maxEntries = 3,
  maxChars = 500,
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const selected = entries.slice(-Math.max(1, Number(maxEntries) || 3));
  const merged = selected
    .map((entry) => String(entry?.text || '').trim())
    .filter(Boolean)
    .join('\n');
  if (!merged) return '';
  return extractManualQuestionFromTranscript(getTranscriptTail(merged, maxChars));
}

const INTERVIEWER_PATTERNS = [
  /\?$/,
  /？$/,
  /\b(tell me|can you|could you|walk me through|why|how|what|when|where|which)\b/i,
  /(请介绍|请你|你能|你可以|为什么|怎么|如何|讲讲|谈谈)/,
];

export function guessSpeakerLabel(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return 'Unknown';

  if (INTERVIEWER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'Interviewer';
  }

  return 'Candidate';
}

export function speakerFromSourceMode(sourceMode = '') {
  const normalized = String(sourceMode || '').trim().toLowerCase();
  if (normalized === 'system') return 'Interviewer';
  if (normalized === 'mic') return 'Candidate';
  return 'Unknown';
}

export function normalizeRecognitionLanguages(language = 'en-US') {
  const values = Array.isArray(language) ? language : [language];
  const cleaned = values
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return cleaned.length > 0 ? [...new Set(cleaned)] : ['en-US'];
}

export function buildSessionExportText({
  transcript = '',
  transcriptEntries = [],
  completedTurns = [],
  metadata = {},
}) {
  const lines = [];
  const now = new Date();

  lines.push('Interview Helper Session Export');
  lines.push(`Generated At: ${now.toISOString()}`);
  if (metadata.topic) lines.push(`Topic: ${metadata.topic}`);
  if (metadata.answerLang) lines.push(`Answer Language: ${metadata.answerLang}`);
  if (metadata.interviewLangs?.length) {
    lines.push(`Interview Languages: ${metadata.interviewLangs.join(', ')}`);
  }
  lines.push('');

  lines.push('=== Full Transcript ===');
  const hasEntries = Array.isArray(transcriptEntries) && transcriptEntries.length > 0;
  if (hasEntries) {
    for (const entry of transcriptEntries) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : now.toISOString();
      const speaker = entry.speaker || 'Unknown';
      const lang = entry.language || 'unknown';
      const text = (entry.text || '').trim();
      if (!text) continue;
      lines.push(`[${ts}] [${speaker}] [${lang}] ${text}`);
    }
  } else {
    lines.push(transcript?.trim() || '(empty)');
  }
  lines.push('');

  lines.push('=== Q&A ===');
  if (completedTurns.length === 0) {
    lines.push('(no completed Q&A turns)');
  } else {
    for (const turn of completedTurns) {
      lines.push(`Q: ${turn.question || ''}`);
      lines.push(`A: ${turn.answer || ''}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
