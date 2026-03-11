import { useEffect, useRef, useState } from 'react';
import {
  normalizeRecognitionLanguages,
  sanitizeTranscriptSegment,
  speakerFromSourceMode,
} from '../utils/interviewTranscript';

/**
 * useTranscript — live speech-to-text via Web Speech API.
 *
 * Supports either a single BCP-47 language tag or a language list.
 * For multi-language mode, recognition auto-rotates between selected languages
 * when no finalized speech has been detected for `rotationIntervalMs`.
 *
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {string|string[]} options.language
 * @param {(text: string) => void} options.onTranscriptChange
 * @param {(segment: { text: string, language: string, timestamp: number }) => void} options.onFinalSegment
 * @param {number} options.rotationIntervalMs
 */
const SPEECH_ERROR_MESSAGES = {
  'not-allowed': 'Microphone access denied. Please allow microphone access in your browser settings and try again.',
  'audio-capture': 'No microphone detected. Please connect a microphone and try again.',
  'network': 'Network error during speech recognition. Please check your connection.',
  'service-not-allowed': 'Speech recognition service is not allowed. Please ensure you are using a supported browser (Chrome or Edge).',
};
const MIN_FINAL_CONFIDENCE = 0.32;
const SHORT_SEGMENT_ALLOWLIST = new Set(['你好', '您好', '可以', '好的', '谢谢', '謝謝', '是的']);

function appendRecognizedText(previous = '', next = '') {
  const left = String(previous || '').trim();
  const right = String(next || '').trim();
  if (!left) return right;
  if (!right) return left;

  const leftEndsWithCjk = /[\u3400-\u9fff]$/.test(left);
  const rightStartsWithCjk = /^[\u3400-\u9fff]/.test(right);
  if (leftEndsWithCjk || rightStartsWithCjk) return `${left}${right}`;
  return `${left} ${right}`;
}

function isLikelyHallucinatedShortSegment(text = '') {
  const cleaned = String(text || '').trim();
  if (!cleaned) return true;
  if (SHORT_SEGMENT_ALLOWLIST.has(cleaned)) return false;

  const compact = cleaned.replace(/\s+/g, '');
  if (compact.length <= 1) return true;

  const hasStrongPunctuation = /[?？!！。,.，]/.test(cleaned);
  if (hasStrongPunctuation) return false;

  const hasCjk = /[\u3400-\u9fff]/.test(cleaned);
  if (hasCjk && compact.length <= 2) return true;

  const latinWords = cleaned.match(/[A-Za-z]+/g) || [];
  if (!hasCjk && latinWords.length <= 1 && compact.length <= 3) return true;

  return false;
}

export function useTranscript({
  enabled = false,
  language = 'en-US',
  onTranscriptChange,
  onFinalSegment,
  rotationIntervalMs = 8000,
} = {}) {
  const languages = normalizeRecognitionLanguages(language);
  const languageKey = languages.join('|');

  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const [activeLanguage, setActiveLanguage] = useState(languages[0]);

  const recognitionRef = useRef(null);
  const enabledRef = useRef(enabled);
  const languagesRef = useRef(languages);
  const activeLanguageRef = useRef(languages[0]);
  const onChangeRef = useRef(onTranscriptChange);
  const onFinalSegmentRef = useRef(onFinalSegment);

  const lastTranscriptRef = useRef('');
  const committedRef = useRef('');
  const sessionFinalRef = useRef('');
  const interimCacheRef = useRef(new Map());
  const languageIndexRef = useRef(0);
  const lastFinalAtRef = useRef(Date.now());
  const rotationMonitorRef = useRef(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onChangeRef.current = onTranscriptChange;
  }, [onTranscriptChange]);

  useEffect(() => {
    onFinalSegmentRef.current = onFinalSegment;
  }, [onFinalSegment]);

  useEffect(() => {
    const normalized = normalizeRecognitionLanguages(language);
    languagesRef.current = normalized;

    const currentLang = activeLanguageRef.current;
    const currentIndex = normalized.indexOf(currentLang);
    languageIndexRef.current = currentIndex >= 0 ? currentIndex : 0;
    activeLanguageRef.current = normalized[languageIndexRef.current];
    setActiveLanguage(activeLanguageRef.current);
  }, [languageKey]);

  useEffect(() => {
    const clearRotationMonitor = () => {
      if (rotationMonitorRef.current) {
        clearInterval(rotationMonitorRef.current);
        rotationMonitorRef.current = null;
      }
    };

    const commitSessionFinal = () => {
      if (sessionFinalRef.current) {
        committedRef.current = `${committedRef.current}${sessionFinalRef.current}\n`;
        sessionFinalRef.current = '';
      }
      interimCacheRef.current.clear();
    };

    if (!enabled) {
      clearRotationMonitor();
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    const configureLanguage = () => {
      const selectedLanguages = languagesRef.current;
      const lang = selectedLanguages[languageIndexRef.current % selectedLanguages.length];
      recognition.lang = lang;
      activeLanguageRef.current = lang;
      setActiveLanguage(lang);
    };

    const maybeRotateLanguage = () => {
      const selectedLanguages = languagesRef.current;
      if (selectedLanguages.length <= 1) return;
      languageIndexRef.current = (languageIndexRef.current + 1) % selectedLanguages.length;
    };

    const startRotationMonitor = () => {
      clearRotationMonitor();
      if (languagesRef.current.length <= 1) return;

      rotationMonitorRef.current = setInterval(() => {
        if (!enabledRef.current || recognitionRef.current !== recognition) return;
        const elapsedSinceLastFinal = Date.now() - lastFinalAtRef.current;
        if (elapsedSinceLastFinal >= rotationIntervalMs) {
          try {
            recognition.stop();
          } catch {
            // ignore
          }
        }
      }, 1000);
    };

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      lastFinalAtRef.current = Date.now();
      startRotationMonitor();
    };

    recognition.onend = () => {
      commitSessionFinal();
      setIsListening(false);
      clearRotationMonitor();

      if (enabledRef.current && recognitionRef.current === recognition) {
        maybeRotateLanguage();
        configureLanguage();
        try {
          recognition.start();
        } catch (err) {
          setError(`Recognition restart failed: ${err.message}`);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(SPEECH_ERROR_MESSAGES[event.error] || `Speech recognition error: ${event.error}`);
    };

    recognition.onresult = (event) => {
      const finalCandidates = [];

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alt = result?.[0];
        const text = alt?.transcript || '';
        const confidence = Number(alt?.confidence);
        const isLowConfidenceFinal = (
          result.isFinal
          && Number.isFinite(confidence)
          && confidence > 0
          && confidence < MIN_FINAL_CONFIDENCE
        );
        if (result.isFinal) {
          if (text && !isLowConfidenceFinal) finalCandidates.push(text);
          interimCacheRef.current.delete(i);
        } else if (text) {
          interimCacheRef.current.set(i, text);
        } else {
          interimCacheRef.current.delete(i);
        }
      }

      let sessionInterim = '';
      for (const text of interimCacheRef.current.values()) {
        sessionInterim += text;
      }

      let acceptedFinalDelta = '';
      for (const candidate of finalCandidates) {
        const cleaned = sanitizeTranscriptSegment(candidate);
        if (!cleaned || isLikelyHallucinatedShortSegment(cleaned)) continue;
        acceptedFinalDelta = appendRecognizedText(acceptedFinalDelta, cleaned);
        onFinalSegmentRef.current?.({
          text: cleaned,
          language: activeLanguageRef.current,
          timestamp: Date.now(),
          sourceMode: 'mic',
          speaker: speakerFromSourceMode('mic'),
        });
      }

      if (acceptedFinalDelta) {
        sessionFinalRef.current = appendRecognizedText(sessionFinalRef.current, acceptedFinalDelta);
        lastFinalAtRef.current = Date.now();
      }

      const current = committedRef.current + sessionFinalRef.current + sessionInterim;
      if (current === lastTranscriptRef.current) return;

      lastTranscriptRef.current = current;
      setTranscript(current);
      onChangeRef.current?.(current);
    };

    configureLanguage();
    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      clearRotationMonitor();
      recognitionRef.current = null;
      commitSessionFinal();
      recognition.stop();
    };
  }, [enabled, languageKey, rotationIntervalMs]);

  const clearTranscript = () => {
    lastTranscriptRef.current = '';
    committedRef.current = '';
    sessionFinalRef.current = '';
    setTranscript('');
  };

  return {
    transcript,
    isListening,
    error,
    activeLanguage,
    clearTranscript,
  };
}
