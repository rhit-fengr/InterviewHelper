'use strict';

const express = require('express');
const request = require('supertest');
const userRouter = require('../routes/user');
const { resetAuthState } = require('../services/auth.service');

describe('user auth routes', () => {
  let app;

  beforeEach(() => {
    resetAuthState();
    app = express();
    app.use(express.json());
    app.use('/api/user', userRouter);
  });

  it('registers a user and returns a bearer token', async () => {
    const res = await request(app)
      .post('/api/user/register')
      .send({ email: 'user@example.com', password: 'password123', name: 'Casey' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('user@example.com');
    expect(res.body.user.plan).toBe('free');
  });

  it('logs in an existing user', async () => {
    await request(app)
      .post('/api/user/register')
      .send({ email: 'user@example.com', password: 'password123', name: 'Casey' });

    const res = await request(app)
      .post('/api/user/login')
      .send({ email: 'user@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('user@example.com');
  });

  it('requires auth for profile reads and writes', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const readRes = await request(app).get('/api/user/profile');
    const writeRes = await request(app)
      .put('/api/user/profile')
      .send({ personalInfo: { fullName: 'Casey' } });

    expect(readRes.status).toBe(401);
    expect(writeRes.status).toBe(401);
    expect(errorSpy).toHaveBeenCalledWith(
      '[user] update profile error:',
      expect.objectContaining({ status: 401 })
    );

    errorSpy.mockRestore();
  });

  it('returns and updates profile for an authenticated user', async () => {
    const registerRes = await request(app)
      .post('/api/user/register')
      .send({ email: 'user@example.com', password: 'password123', name: 'Casey' });
    const token = registerRes.body.token;

    const getRes = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.email).toBe('user@example.com');

    const updateRes = await request(app)
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Casey Nguyen',
        personalInfo: { fullName: 'Casey Nguyen', currentRole: 'Engineer' },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.updated).toBe(true);
    expect(updateRes.body.user.name).toBe('Casey Nguyen');
    expect(updateRes.body.user.personalInfo.currentRole).toBe('Engineer');
  });
});
