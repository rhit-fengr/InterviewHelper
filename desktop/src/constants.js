/**
 * Shared UI constants for the desktop application.
 * Single source of truth for dropdown options used across components.
 */

export const TOPICS = [
  { value: 'software-engineering', label: 'Software Engineering' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system-design', label: 'System Design' },
  { value: 'data-structures', label: 'Data Structures & Algorithms' },
  { value: 'product-management', label: 'Product Management' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'finance', label: 'Finance' },
  { value: 'general', label: 'General' },
];

export const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
];

export const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'ar-SA', label: 'Arabic' },
];

export const BEHAVIORAL_STRUCTURES = ['STAR', 'CAR', 'PAR', 'SOAR'];

export const ANSWER_LENGTHS = [
  { value: 'short', label: 'Short (~30s)' },
  { value: 'medium', label: 'Medium (~1min)' },
  { value: 'long', label: 'Long (~2min)' },
];

export const DETECTION_SENSITIVITIES = [
  { value: 'low', label: 'Low — explicit questions only' },
  { value: 'medium', label: 'Medium — clear + implied questions' },
  { value: 'high', label: 'High — any prompt/statement' },
];

export const RESPONSE_STYLES = [
  { value: 'conversational', label: 'Conversational' },
  { value: 'structured', label: 'Structured' },
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
];
