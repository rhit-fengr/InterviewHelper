import { useState, useEffect, useRef } from 'react';

/**
 * useTranscript — live speech-to-text via Web Speech API.
 *
 * @param {object} options
 * @param {boolean} options.enabled   - Whether recognition is active
 * @param {string|string[]}  options.language  - BCP-47 language tag (e.g. "en-US") or array of tags
 * @param {(text: string) => void} options.onTranscriptChange - Called on every update
 */
const SPEECH_ERROR_MESSAGES = {
  'not-allowed': 'Microphone access denied. Please allow microphone access in your browser settings and try again.',
  'audio-capture': 'No microphone detected. Please connect a microphone and try again.',
  'network': 'Network error during speech recognition. Please check your connection.',
  'service-not-allowed': 'Speech recognition service is not allowed. Please ensure you are using a supported browser (Chrome or Edge).',
};

export function useTranscript({ enabled = false, language = 'en-US', onTranscriptChange } = {}) {
  // Support array of languages — use the first selected language for recognition
  const primaryLanguage = Array.isArray(language) ? (language[0] || 'en-US') : (language || 'en-US');
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  // Keep a stable ref to the latest enabled value so onend never closes over a stale copy.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  // Keep a stable ref to the callback so the recognition effect does not
  // restart whenever the caller re-renders with a new function reference.
  const onChangeRef = useRef(onTranscriptChange);
  useEffect(() => { onChangeRef.current = onTranscriptChange; }, [onTranscriptChange]);
  // Track last emitted transcript to skip no-op updates (reduces re-renders in Chrome)
  const lastTranscriptRef = useRef('');
  // Accumulate finalized text across recognition session restarts
  const committedRef = useRef('');
  // Track final-only text from the current session (committed on session end)
  const sessionFinalRef = useRef('');

  useEffect(() => {
    if (!enabled) {
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
    recognition.lang = primaryLanguage;

    recognition.onstart = () => {
      setIsListening(true);
      // Clear any previous error so stale messages don't persist after a
      // successful restart (e.g. after the user grants microphone permission).
      setError(null);
    };
    recognition.onend = () => {
      // Commit the finalized text from this session before restarting, adding a trailing
      // newline so the next session's text always starts on a new line in the transcript.
      if (sessionFinalRef.current) {
        committedRef.current = committedRef.current + sessionFinalRef.current + '\n';
      }
      sessionFinalRef.current = '';
      setIsListening(false);
      // Read the ref — not the closed-over value — to decide whether to restart.
      // This prevents accidental restarts after the user has toggled listening off.
      if (enabledRef.current && recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch (err) {
          setError(`Recognition restart failed: ${err.message}`);
        }
      }
    };

    recognition.onerror = (event) => {
      // Ignore non-error conditions: brief silence and mid-session restarts
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(SPEECH_ERROR_MESSAGES[event.error] || `Speech recognition error: ${event.error}`);
    };

    recognition.onresult = (event) => {
      let sessionFinal = '';
      let sessionInterim = '';
      for (const result of Array.from(event.results)) {
        if (result.isFinal) {
          sessionFinal += result[0].transcript;
        } else {
          sessionInterim += result[0].transcript;
        }
      }
      // Keep track of final text in this session so onend can commit it
      sessionFinalRef.current = sessionFinal;

      const current = committedRef.current + sessionFinal + sessionInterim;

      // Skip no-op updates — Chrome fires onresult very frequently with interim
      // results; skipping duplicates prevents unnecessary re-renders.
      if (current === lastTranscriptRef.current) return;
      lastTranscriptRef.current = current;

      setTranscript(current);
      onChangeRef.current?.(current);
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      // Nullify the ref before stopping so onend won't auto-restart
      recognitionRef.current = null;
      lastTranscriptRef.current = '';
      committedRef.current = '';
      sessionFinalRef.current = '';
      recognition.stop();
    };
  }, [enabled, primaryLanguage]);

  const clearTranscript = () => {
    // Reset the de-dupe ref and all accumulated text so subsequent Web Speech results are not skipped.
    lastTranscriptRef.current = '';
    committedRef.current = '';
    sessionFinalRef.current = '';
    setTranscript('');
  };

  return { transcript, isListening, error, clearTranscript };
}
