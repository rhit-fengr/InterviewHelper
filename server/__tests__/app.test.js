'use strict';

const request = require('supertest');
const app = require('../app');

describe('Health endpoint', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Session routes', () => {
  let createdSessionId;

  it('POST /api/session/create creates a session', async () => {
    const res = await request(app)
      .post('/api/session/create')
      .send({ userId: 'user_1', setup: { topic: 'software-engineering' } });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    createdSessionId = res.body.sessionId;
  });

  it('GET /api/session/:id returns session', async () => {
    const res = await request(app).get(`/api/session/${createdSessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(createdSessionId);
  });

  it('GET /api/session/:id returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/session/nonexistent');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/session/:id ends a session', async () => {
    const res = await request(app).delete(`/api/session/${createdSessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Session ended');
  });
});

describe('User routes', () => {
  it('GET /api/user/profile returns profile', async () => {
    const res = await request(app).get('/api/user/profile');
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('PUT /api/user/profile updates profile', async () => {
    const personalInfo = { fullName: 'Jane Doe', currentRole: 'Engineer' };
    const res = await request(app)
      .put('/api/user/profile')
      .send({ personalInfo });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.personalInfo.fullName).toBe('Jane Doe');
  });
});

describe('AI routes (no OpenAI key)', () => {
  // When OPENAI_API_KEY is absent, routes return 503 before checking request body.
  it('POST /api/ai/answer returns 503 when AI not configured', async () => {
    const res = await request(app)
      .post('/api/ai/answer')
      .send({ question: 'Tell me about yourself' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('POST /api/ai/detect-question returns 503 when AI not configured', async () => {
    const res = await request(app)
      .post('/api/ai/detect-question')
      .send({ transcript: 'Tell me about yourself' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
