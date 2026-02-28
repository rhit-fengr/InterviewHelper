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
