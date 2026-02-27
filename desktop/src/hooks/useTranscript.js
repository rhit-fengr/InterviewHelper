import { useState, useEffect, useRef } from 'react';

/**
 * useTranscript — live speech-to-text via Web Speech API.
 *
 * @param {object} options
 * @param {boolean} options.enabled   - Whether recognition is active
 * @param {string}  options.language  - BCP-47 language tag (e.g. "en-US")
 * @param {(text: string) => void} options.onTranscriptChange - Called on every update
 */
const SPEECH_ERROR_MESSAGES = {
  'not-allowed': 'Microphone access denied. Please allow microphone access in your browser settings and try again.',
  'audio-capture': 'No microphone detected. Please connect a microphone and try again.',
  'network': 'Network error during speech recognition. Please check your connection.',
  'service-not-allowed': 'Speech recognition service is not allowed. Please ensure you are using a supported browser (Chrome or Edge).',
};

export function useTranscript({ enabled = false, language = 'en-US', onTranscriptChange } = {}) {
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
    recognition.lang = language;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
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
      const current = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');

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
      recognition.stop();
    };
  }, [enabled, language]);

  const clearTranscript = () => setTranscript('');

  return { transcript, isListening, error, clearTranscript };
}
