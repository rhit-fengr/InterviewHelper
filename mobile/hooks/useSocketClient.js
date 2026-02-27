import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * useSocketClient — manages a Socket.io connection for the mobile companion app.
 *
 * Connects to the server, joins an existing session by code, then receives
 * answer chunks and transcript updates streamed from the desktop host.
 *
 * @param {object} options
 * @param {string} options.serverUrl          - Backend server URL (e.g. http://192.168.1.5:4000)
 * @param {string} options.sessionCode        - Session code created by the desktop host
 * @param {() => void} [options.onSessionJoined]      - Called when successfully joined
 * @param {(msg: string) => void} [options.onSessionError] - Called on join failure
 * @param {(chunk: string, isDone: boolean) => void} [options.onAnswerChunk] - Answer delta received
 * @param {(transcript: string) => void} [options.onTranscriptUpdate] - Transcript received
 * @param {() => void} [options.onHostDisconnected]   - Called when desktop host disconnects
 */
export function useSocketClient({
  serverUrl,
  sessionCode,
  onSessionJoined,
  onSessionError,
  onAnswerChunk,
  onTranscriptUpdate,
  onHostDisconnected,
} = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('idle'); // 'idle' | 'connecting' | 'joined' | 'error'

  // Keep stable refs for callbacks so the socket effect is not re-run when
  // the caller re-renders with new function references.
  const onSessionJoinedRef = useRef(onSessionJoined);
  const onSessionErrorRef = useRef(onSessionError);
  const onAnswerChunkRef = useRef(onAnswerChunk);
  const onTranscriptUpdateRef = useRef(onTranscriptUpdate);
  const onHostDisconnectedRef = useRef(onHostDisconnected);
  useEffect(() => { onSessionJoinedRef.current = onSessionJoined; }, [onSessionJoined]);
  useEffect(() => { onSessionErrorRef.current = onSessionError; }, [onSessionError]);
  useEffect(() => { onAnswerChunkRef.current = onAnswerChunk; }, [onAnswerChunk]);
  useEffect(() => { onTranscriptUpdateRef.current = onTranscriptUpdate; }, [onTranscriptUpdate]);
  useEffect(() => { onHostDisconnectedRef.current = onHostDisconnected; }, [onHostDisconnected]);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!serverUrl || !sessionCode) return;

    setSessionStatus('connecting');
    const socket = io(serverUrl, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      // Join the session as soon as we connect (or reconnect)
      socket.emit('join-session', { sessionCode });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('session-joined', () => {
      setSessionStatus('joined');
      onSessionJoinedRef.current?.();
    });

    socket.on('session-error', ({ message }) => {
      setSessionStatus('error');
      onSessionErrorRef.current?.(message || 'Failed to join session');
    });

    socket.on('answer-chunk', ({ chunk, isDone }) => {
      onAnswerChunkRef.current?.(chunk, isDone);
    });

    socket.on('transcript-update', ({ transcript }) => {
      onTranscriptUpdateRef.current?.(transcript);
    });

    socket.on('host-disconnected', () => {
      setSessionStatus('error');
      onHostDisconnectedRef.current?.();
    });

    socket.on('connect_error', (error) => {
      setSessionStatus('error');
      const base = 'Unable to connect to the server. Please check the server URL and your network connection.';
      const message = error?.message ? `${base} (${error.message})` : base;
      onSessionErrorRef.current?.(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, sessionCode]);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
  }, []);

  return { isConnected, sessionStatus, disconnect };
}
