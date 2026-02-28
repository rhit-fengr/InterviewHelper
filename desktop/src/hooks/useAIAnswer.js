import { useState, useCallback, useRef } from 'react';
import { consumeSSEChunk, flushSSEState } from '../utils/sse';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

/**
 * useAIAnswer — sends a detected question to the backend and streams the answer.
 *
 * The server sends JSON-encoded SSE events: `data: {"text":"..."}\n\n`
 * or `data: {"done":true}\n\n` / `data: {"error":"..."}\n\n`.
 * We buffer partial reads to handle chunk boundary splits correctly.
 */
export function useAIAnswer() {
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const generateAnswer = useCallback(async ({ question, personalInfo, answerSettings, setup, conversationHistory }) => {
    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    setAnswer('');

    try {
      const response = await fetch(`${SERVER_URL}/api/ai/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: setup?.aiProvider,
          question,
          personalInfo,
          answerSettings,
          setup,
          conversationHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `Server error: ${response.status}`;
        try {
          const body = await response.json();
          if (body.error) message = body.error;
        } catch { /* ignore parse errors */ }
        throw new Error(message);
      }

      // Ensure the response body is available for streaming
      if (!response.body) {
        throw new Error('Streaming not supported: response body is not available.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';
      let parserState = { buffer: '', eventData: '' };
      let shouldStop = false;

      const processEventData = (eventData) => {
        try {
          const parsed = JSON.parse(eventData);
          if (parsed.done) {
            return true;
          }
          if (parsed.error) {
            setError(parsed.error);
            return true;
          }
          if (parsed.text) {
            fullAnswer += parsed.text;
            setAnswer(fullAnswer);
          }
        } catch {
          // Malformed JSON chunk — skip
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = decoder.decode(value, { stream: true });
        const parsedChunk = consumeSSEChunk(decoded, parserState);
        parserState = parsedChunk.state;

        for (const eventData of parsedChunk.events) {
          if (processEventData(eventData)) {
            shouldStop = true;
            break;
          }
        }

        if (shouldStop) {
          break;
        }
      }

      if (!shouldStop) {
        const flushed = flushSSEState(parserState);
        for (const eventData of flushed.events) {
          if (processEventData(eventData)) {
            break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        // TypeError with 'fetch' in the message means the server is unreachable
        const isNetworkError = err.name === 'TypeError' && /fetch/i.test(err.message);
        setError(
          isNetworkError
            ? `Cannot connect to server at ${SERVER_URL}. Make sure the backend server is running (cd server && npm run dev).`
            : err.message
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clearAnswer = useCallback(() => {
    setAnswer('');
    setError(null);
  }, []);

  return { answer, isLoading, error, generateAnswer, cancelGeneration, clearAnswer };
}
