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
      // Auto-restart if still enabled
      if (enabled) {
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
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [enabled, language]);

  const clearTranscript = () => setTranscript('');

  return { transcript, isListening, error, clearTranscript };
}
