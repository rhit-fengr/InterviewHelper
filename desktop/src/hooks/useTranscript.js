import { useState, useEffect, useRef } from 'react';

/**
 * useTranscript — live speech-to-text via Web Speech API.
 *
 * @param {object} options
 * @param {boolean} options.enabled   - Whether recognition is active
 * @param {string}  options.language  - BCP-47 language tag (e.g. "en-US")
 * @param {(text: string) => void} options.onTranscriptChange - Called on every update
 */
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
      if (event.error !== 'no-speech') {
        setError(event.error);
      }
    };

    recognition.onresult = (event) => {
      const current = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');

      setTranscript(current);
      onChangeRef.current?.(current);
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      // Nullify the ref before stopping so onend won't auto-restart
      recognitionRef.current = null;
      recognition.stop();
    };
  }, [enabled, language]);

  const clearTranscript = () => setTranscript('');

  return { transcript, isListening, error, clearTranscript };
}
