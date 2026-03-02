import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

/**
 * useSocketSync — manages a Socket.io connection for Undetectable Mode.
 *
 * Desktop (host) creates a session; mobile (client) joins with the session code.
 * The host streams transcript and answer chunks to the connected mobile device.
 */
export function useSocketSync({ role = 'host' } = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [clientConnected, setClientConnected] = useState(false);
  const [sessionCode, setSessionCode] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => {
      setIsConnected(false);
      setClientConnected(false);
    });

    if (role === 'host') {
      socket.on('client-connected', () => setClientConnected(true));
      socket.on('client-disconnected', () => setClientConnected(false));
    }

    return () => {
      socket.disconnect();
    };
  }, [role]);

  const createSession = useCallback((code) => {
    setSessionCode(code);
    socketRef.current?.emit('create-session', {
      sessionCode: code,
      deviceInfo: navigator.userAgent,
    });
  }, []);

  const joinSession = useCallback((code) => {
    socketRef.current?.emit('join-session', { sessionCode: code });
  }, []);

  const streamAnswerChunk = useCallback((code, chunk, isDone = false) => {
    socketRef.current?.emit('stream-answer', { sessionCode: code, chunk, isDone });
  }, []);

  const streamTranscript = useCallback((code, transcript, metadata = {}) => {
    socketRef.current?.emit('transcript-update', {
      sessionCode: code,
      transcript,
      ...metadata,
    });
  }, []);

  const onAnswerChunk = useCallback((handler) => {
    socketRef.current?.on('answer-chunk', handler);
    return () => socketRef.current?.off('answer-chunk', handler);
  }, []);

  const onTranscriptUpdate = useCallback((handler) => {
    socketRef.current?.on('transcript-update', handler);
    return () => socketRef.current?.off('transcript-update', handler);
  }, []);

  return {
    isConnected,
    clientConnected,
    sessionCode,
    createSession,
    joinSession,
    streamAnswerChunk,
    streamTranscript,
    onAnswerChunk,
    onTranscriptUpdate,
  };
}
