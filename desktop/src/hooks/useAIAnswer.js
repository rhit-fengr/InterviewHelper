import { useState, useCallback, useRef } from 'react';

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
        body: JSON.stringify({ question, personalInfo, answerSettings, setup, conversationHistory }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Ensure the response body is available for streaming
      if (!response.body) {
        throw new Error('Streaming not supported: response body is not available.');
      }
      if (!response.body) {
        throw new Error('Streaming not supported: response body is not available.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';

      // SSE buffer — accumulates partial data across network chunk boundaries
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // Split into complete lines; keep the last partial line in the buffer
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() ?? '';

        // Accumulate data lines until the empty-line event boundary
        let eventData = '';
        for (const line of lines) {
          if (line === '') {
            // Empty line → dispatch the accumulated event
            if (eventData) {
              try {
                const parsed = JSON.parse(eventData);
                if (parsed.done) {
                  return; // Stream finished cleanly
                }
                if (parsed.error) {
                  setError(parsed.error);
                  return;
                }
                if (parsed.text) {
                  fullAnswer += parsed.text;
                  setAnswer(fullAnswer);
                }
              } catch {
                // Malformed JSON chunk — skip
              }
              eventData = '';
            }
          } else if (line.startsWith('data:')) {
            // Append (trimmed) data line content
            eventData += line.slice(5).trimStart();
          }
          // Ignore comment lines (`:`) and field names we don't use
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
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
