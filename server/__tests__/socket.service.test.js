'use strict';

const http = require('http');
const { io: createSocketClient } = require('socket.io-client');
const {
  initSocketServer,
  parseCorsOrigin,
  normalizeSessionCode,
  isValidSessionCode,
} = require('../services/socket.service');

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);

    socket.once(event, (...args) => {
      clearTimeout(timeout);
      resolve(args);
    });
  });
}

function expectNoEvent(socket, event, waitMs = 300) {
  return new Promise((resolve, reject) => {
    const handler = (...args) => {
      clearTimeout(timeout);
      reject(new Error(`Unexpected "${event}" event: ${JSON.stringify(args)}`));
    };
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);

    socket.once(event, handler);
  });
}

async function connectClient(url) {
  const socket = createSocketClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  await waitForEvent(socket, 'connect');
  return socket;
}

describe('socket.service helpers', () => {
  it('parses CORS origin config correctly', () => {
    expect(parseCorsOrigin(undefined)).toBe('*');
    expect(parseCorsOrigin('')).toBe('*');
    expect(parseCorsOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseCorsOrigin('http://a.com, http://b.com')).toEqual(['http://a.com', 'http://b.com']);
  });

  it('normalizes and validates session codes', () => {
    expect(normalizeSessionCode(' iron-1234 ')).toBe('IRON-1234');
    expect(isValidSessionCode('IRON-1234')).toBe(true);
    expect(isValidSessionCode('bad code')).toBe(false);
    expect(isValidSessionCode('IRON1234')).toBe(false);
  });
});

describe('socket.service integration', () => {
  let httpServer;
  let ioServer;
  let baseUrl;

  beforeEach(async () => {
    httpServer = http.createServer();
    ioServer = initSocketServer(httpServer);

    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = httpServer.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('creates a host session, joins from mobile, and forwards transcript/answer deltas', async () => {
    const host = await connectClient(baseUrl);
    const mobile = await connectClient(baseUrl);

    const createdPromise = waitForEvent(host, 'session-created');
    host.emit('create-session', { sessionCode: 'iron-1234' });
    const [{ sessionCode }] = await createdPromise;
    expect(sessionCode).toBe('IRON-1234');

    const hostConnectedPromise = waitForEvent(host, 'client-connected');
    const joinedPromise = waitForEvent(mobile, 'session-joined');
    mobile.emit('join-session', { sessionCode: 'IRON-1234' });
    await joinedPromise;
    await hostConnectedPromise;

    const transcriptPromise = waitForEvent(mobile, 'transcript-update');
    host.emit('transcript-update', { sessionCode: 'IRON-1234', transcript: 'Tell me about yourself' });
    const [{ transcript }] = await transcriptPromise;
    expect(transcript).toBe('Tell me about yourself');

    const answerPromise = waitForEvent(mobile, 'answer-chunk');
    host.emit('stream-answer', { sessionCode: 'IRON-1234', chunk: 'Hello', isDone: false });
    const [{ chunk, isDone }] = await answerPromise;
    expect(chunk).toBe('Hello');
    expect(isDone).toBe(false);

    host.disconnect();
    mobile.disconnect();
  });

  it('rejects invalid session codes and duplicate host session codes', async () => {
    const hostA = await connectClient(baseUrl);
    const hostB = await connectClient(baseUrl);

    const invalidPromise = waitForEvent(hostA, 'session-error');
    hostA.emit('create-session', { sessionCode: 'bad' });
    const [{ message: invalidMessage }] = await invalidPromise;
    expect(invalidMessage).toMatch(/invalid session code/i);

    const createdPromise = waitForEvent(hostA, 'session-created');
    hostA.emit('create-session', { sessionCode: 'IRON-1234' });
    await createdPromise;

    const duplicatePromise = waitForEvent(hostB, 'session-error');
    hostB.emit('create-session', { sessionCode: 'IRON-1234' });
    const [{ message: duplicateMessage }] = await duplicatePromise;
    expect(duplicateMessage).toMatch(/already in use/i);

    hostA.disconnect();
    hostB.disconnect();
  });

  it('prevents mobile client from spoofing streamed transcript/answer events', async () => {
    const host = await connectClient(baseUrl);
    const mobile = await connectClient(baseUrl);

    const createdPromise = waitForEvent(host, 'session-created');
    host.emit('create-session', { sessionCode: 'IRON-1234' });
    await createdPromise;

    const joinedPromise = waitForEvent(mobile, 'session-joined');
    mobile.emit('join-session', { sessionCode: 'IRON-1234' });
    await joinedPromise;

    mobile.emit('transcript-update', { sessionCode: 'IRON-1234', transcript: 'spoofed' });
    mobile.emit('stream-answer', { sessionCode: 'IRON-1234', chunk: 'spoofed', isDone: false });

    await expectNoEvent(mobile, 'transcript-update');
    await expectNoEvent(mobile, 'answer-chunk');

    host.disconnect();
    mobile.disconnect();
  });

  it('notifies mobile client when host disconnects', async () => {
    const host = await connectClient(baseUrl);
    const mobile = await connectClient(baseUrl);

    const createdPromise = waitForEvent(host, 'session-created');
    host.emit('create-session', { sessionCode: 'IRON-1234' });
    await createdPromise;

    const joinedPromise = waitForEvent(mobile, 'session-joined');
    mobile.emit('join-session', { sessionCode: 'IRON-1234' });
    await joinedPromise;

    const hostDisconnectedPromise = waitForEvent(mobile, 'host-disconnected');
    host.disconnect();
    await hostDisconnectedPromise;

    mobile.disconnect();
  });
});
