import { renderHook, act } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { useSocketClient } from '../hooks/useSocketClient';

beforeEach(() => {
  io.mockClear();
  const socket = io.getLastSocket?.();
  if (socket) {
    socket.on.mockClear();
    socket.emit.mockClear();
    socket.disconnect.mockClear();
  }
});

describe('useSocketClient', () => {
  it('does not create a socket when serverUrl or sessionCode are absent', () => {
    renderHook(() => useSocketClient({ serverUrl: '', sessionCode: '' }));
    expect(io).not.toHaveBeenCalled();
  });

  it('creates a socket and emits join-session on connect', () => {
    renderHook(() =>
      useSocketClient({ serverUrl: 'http://localhost:4000', sessionCode: 'TEST-1234' })
    );

    // Socket should have been created
    expect(io).toHaveBeenCalledWith('http://localhost:4000', expect.any(Object));

    const socket = io.getLastSocket();
    expect(socket).not.toBeNull();

    // Simulate server connect event
    act(() => {
      socket._trigger('connect');
    });

    // Should emit join-session with the code
    expect(socket.emit).toHaveBeenCalledWith('join-session', { sessionCode: 'TEST-1234' });
  });

  it('sets sessionStatus to "joined" when session-joined fires', () => {
    const { result } = renderHook(() =>
      useSocketClient({ serverUrl: 'http://localhost:4000', sessionCode: 'TEST-1234' })
    );

    const socket = io.getLastSocket();

    act(() => { socket._trigger('connect'); });
    act(() => { socket._trigger('session-joined'); });

    expect(result.current.sessionStatus).toBe('joined');
  });

  it('calls onSessionJoined callback when session-joined fires', () => {
    const onSessionJoined = jest.fn();
    renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'TEST-1234',
        onSessionJoined,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => { socket._trigger('session-joined'); });

    expect(onSessionJoined).toHaveBeenCalledTimes(1);
  });

  it('sets sessionStatus to "error" and calls onSessionError on session-error', () => {
    const onSessionError = jest.fn();
    const { result } = renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'BAD-CODE',
        onSessionError,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => { socket._trigger('session-error', { message: 'Session not found' }); });

    expect(result.current.sessionStatus).toBe('error');
    expect(onSessionError).toHaveBeenCalledWith('Session not found');
  });

  it('calls onAnswerChunk with chunk and isDone flag', () => {
    const onAnswerChunk = jest.fn();
    renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'TEST-1234',
        onAnswerChunk,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => { socket._trigger('answer-chunk', { chunk: 'Hello', isDone: false }); });
    act(() => { socket._trigger('answer-chunk', { chunk: ' world', isDone: false }); });
    act(() => { socket._trigger('answer-chunk', { chunk: '', isDone: true }); });

    expect(onAnswerChunk).toHaveBeenNthCalledWith(1, 'Hello', false);
    expect(onAnswerChunk).toHaveBeenNthCalledWith(2, ' world', false);
    expect(onAnswerChunk).toHaveBeenNthCalledWith(3, '', true);
  });

  it('calls onTranscriptUpdate with transcript text', () => {
    const onTranscriptUpdate = jest.fn();
    renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'TEST-1234',
        onTranscriptUpdate,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => {
      socket._trigger('transcript-update', { transcript: 'Tell me about yourself' });
    });

    expect(onTranscriptUpdate).toHaveBeenCalledWith('Tell me about yourself');
  });

  it('passes transcript payload metadata when callback accepts second argument', () => {
    const onTranscriptUpdate = jest.fn((text, payload) => ({ text, payload }));
    renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'TEST-1234',
        onTranscriptUpdate,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => {
      socket._trigger('transcript-update', {
        transcript: '自我介绍一下',
        language: 'zh-CN',
        speaker: 'Interviewer',
      });
    });

    expect(onTranscriptUpdate).toHaveBeenCalledWith(
      '自我介绍一下',
      expect.objectContaining({
        language: 'zh-CN',
        speaker: 'Interviewer',
      })
    );
  });

  it('sets sessionStatus to "error" and calls onHostDisconnected on host-disconnected', () => {
    const onHostDisconnected = jest.fn();
    const { result } = renderHook(() =>
      useSocketClient({
        serverUrl: 'http://localhost:4000',
        sessionCode: 'TEST-1234',
        onHostDisconnected,
      })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    act(() => { socket._trigger('session-joined'); });
    act(() => { socket._trigger('host-disconnected'); });

    expect(result.current.sessionStatus).toBe('error');
    expect(onHostDisconnected).toHaveBeenCalledTimes(1);
  });

  it('updates isConnected to false on disconnect event', () => {
    const { result } = renderHook(() =>
      useSocketClient({ serverUrl: 'http://localhost:4000', sessionCode: 'TEST-1234' })
    );

    const socket = io.getLastSocket();
    act(() => { socket._trigger('connect'); });
    expect(result.current.isConnected).toBe(true);

    act(() => { socket._trigger('disconnect'); });
    expect(result.current.isConnected).toBe(false);
  });

  it('disconnects socket on unmount', () => {
    const { unmount } = renderHook(() =>
      useSocketClient({ serverUrl: 'http://localhost:4000', sessionCode: 'TEST-1234' })
    );

    const socket = io.getLastSocket();
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('sets sessionStatus to "error" and calls onSessionError on connect_error', () => {
    const onSessionError = jest.fn();
    const { result } = renderHook(() =>
      useSocketClient({
        serverUrl: 'http://unreachable:4000',
        sessionCode: 'TEST-1234',
        onSessionError,
      })
    );

    const socket = io.getLastSocket();
    act(() => {
      socket._trigger('connect_error', new Error('ECONNREFUSED'));
    });

    expect(result.current.sessionStatus).toBe('error');
    expect(onSessionError).toHaveBeenCalledWith(
      expect.stringContaining('Unable to connect to the server')
    );
    expect(onSessionError).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED')
    );
  });

  it('calls onSessionError with base message when connect_error has no message', () => {
    const onSessionError = jest.fn();
    renderHook(() =>
      useSocketClient({
        serverUrl: 'http://unreachable:4000',
        sessionCode: 'TEST-1234',
        onSessionError,
      })
    );

    const socket = io.getLastSocket();
    act(() => {
      socket._trigger('connect_error', {});
    });

    expect(onSessionError).toHaveBeenCalledWith(
      expect.stringContaining('Unable to connect to the server')
    );
  });
});
