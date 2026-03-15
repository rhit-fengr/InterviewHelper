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
  /livecaptions-translator\/[^\s]+/gi,
];
const TRANSCRIPT_NOISE_ONLY_PATTERNS = [
  /^(感谢观看|謝謝觀看|谢谢观看|本视频到这里|本影片到這裡)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(点赞订阅|點讚訂閱|記得訂閱|记得订阅|别忘了订阅|別忘了訂閱|like and subscribe)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(address and search bar|address bar|search bar|search or type url|地址和搜索栏|地址列|搜索栏)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(ready to show live captions(?: in .*)?|.*\bat master\b.*livecaptions-translator.*)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(change language|include microphone audio|change language include microphone audio)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(更改语言|切换语言|包括麦克风音频|包含麦克风音频|包含麥克風音訊|包括麥克風音訊)(?:[^\p{L}\p{N}\u4e00-\u9fa5].*)?$/iu,
  /^(字幕|caption|captions)(?:\s|$)/iu,
];
const MIN_REPEAT_UNIT_CHARS = 8;
const MAX_REPEAT_UNIT_CHARS = 120;
const MAX_REPEAT_COLLAPSE_ROUNDS = 3;

function collapseConsecutiveRepeatedSubstrings(text = '') {
  let value = String(text || '');
  if (!value) return '';

  for (let round = 0; round < MAX_REPEAT_COLLAPSE_ROUNDS; round += 1) {
    let replaced = false;
    const textLength = value.length;
    if (textLength < MIN_REPEAT_UNIT_CHARS * 2) break;

    const maxUnit = Math.min(MAX_REPEAT_UNIT_CHARS, Math.floor(textLength / 2));
    for (let unitLength = maxUnit; unitLength >= MIN_REPEAT_UNIT_CHARS; unitLength -= 1) {
      for (let start = 0; start + unitLength * 2 <= value.length; start += 1) {
        const unit = value.slice(start, start + unitLength);
        if (!/[\p{L}\p{N}\u4e00-\u9fa5]/u.test(unit)) continue;

        let repeats = 1;
        while (
          start + (repeats + 1) * unitLength <= value.length
          && value.slice(
            start + repeats * unitLength,
            start + (repeats + 1) * unitLength,
          ) === unit
        ) {
          repeats += 1;
        }

        if (repeats < 2) continue;
        value = value.slice(0, start + unitLength) + value.slice(start + repeats * unitLength);
        replaced = true;
        break;
      }
      if (replaced) break;
    }

    if (!replaced) break;
  }

  return value;
}

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
  cleaned = collapseConsecutiveRepeatedSubstrings(cleaned)
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';

  // Guard against standalone watermark-like leftovers.
  if (/^(字幕|captions?)(?:\s|$)/i.test(cleaned) && cleaned.length <= 24) {
    return '';
  }
  if (TRANSCRIPT_NOISE_ONLY_PATTERNS.some((pattern) => pattern.test(cleaned))) {
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
