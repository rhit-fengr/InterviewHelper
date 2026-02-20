import { useState, useCallback, useRef } from 'react';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

/**
 * useAIAnswer — sends a detected question to the backend and streams the answer.
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

      // Read the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE lines: "data: <text>\n\n"
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6);
            if (text === '[DONE]') break;
            fullAnswer += text;
            setAnswer(fullAnswer);
          }
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
