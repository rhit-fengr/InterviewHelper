'use strict';

/**
 * Shared constants and utilities used by both desktop and server.
 */

const TOPICS = [
  'software-engineering',
  'behavioral',
  'system-design',
  'data-structures',
  'product-management',
  'data-science',
  'finance',
  'general',
];

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ar-SA', label: 'Arabic' },
];

const DETECTION_SENSITIVITIES = ['low', 'medium', 'high'];

const ANSWER_LENGTHS = ['short', 'medium', 'long'];

const BEHAVIORAL_STRUCTURES = ['STAR', 'CAR', 'PAR', 'SOAR'];

module.exports = {
  TOPICS,
  LANGUAGES,
  DETECTION_SENSITIVITIES,
  ANSWER_LENGTHS,
  BEHAVIORAL_STRUCTURES,
};
