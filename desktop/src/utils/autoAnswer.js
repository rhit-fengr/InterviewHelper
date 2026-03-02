export function normalizeQuestionKey(question = '') {
  return String(question || '')
    .trim()
    .toLowerCase()
    .replace(/[?？!！.,，。:：;；"'`~()[\]{}]/g, '')
    .replace(/\s+/g, ' ');
}

export function shouldSkipAutoAnswer({
  question = '',
  lastAuto = null,
  pendingQuestion = '',
  isLoading = false,
  now = Date.now(),
  dedupeWindowMs = 30_000,
} = {}) {
  const key = normalizeQuestionKey(question);
  if (!key) return true;

  const pendingKey = normalizeQuestionKey(pendingQuestion);
  if (isLoading && pendingKey && pendingKey === key) {
    return true;
  }

  if (lastAuto?.key === key && now - (lastAuto.at || 0) < dedupeWindowMs) {
    return true;
  }

  return false;
}
