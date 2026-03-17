'use strict';

jest.mock('stripe', () => {
  const mockStripe = {
    customers: {
      create: jest.fn(),
      update: jest.fn(),
    },
    paymentMethods: {
      attach: jest.fn(),
    },
    subscriptions: {
      create: jest.fn(),
      update: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };

  const factory = jest.fn(() => mockStripe);
  factory.__mockStripe = mockStripe;
  return factory;
});

const express = require('express');
const request = require('supertest');

describe('billing routes', () => {
  let app;
  let userRouter;
  let billingRouter;
  let stripe;
  let resetAuthState;

  beforeEach(() => {
    jest.resetModules();
    resetAuthState = require('../services/auth.service').resetAuthState;
    resetAuthState();
    process.env.STRIPE_SECRET_KEY = 'sk_test_demo';
    process.env.STRIPE_PRICE_ID = 'price_demo';
    userRouter = require('../routes/user');
    billingRouter = require('../routes/billing');
    const stripeFactory = require('stripe');
    stripe = stripeFactory.__mockStripe;
    stripe.customers.create.mockReset();
    stripe.customers.update.mockReset();
    stripe.paymentMethods.attach.mockReset();
    stripe.subscriptions.create.mockReset();
    stripe.subscriptions.update.mockReset();
    stripe.webhooks.constructEvent.mockReset();

    app = express();
    app.use(express.json());
    app.use('/api/user', userRouter);
    app.use('/api/billing', billingRouter);
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
  });

  async function registerAndToken() {
    const res = await request(app)
      .post('/api/user/register')
      .send({ email: 'pro@example.com', password: 'password123', name: 'Pro User' });
    return res.body.token;
  }

  it('returns billing status for an authenticated user', async () => {
    const token = await registerAndToken();
    const res = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.subscriptionStatus).toBe('inactive');
  });

  it('creates a customer and stores the customer id on the authenticated user', async () => {
    stripe.customers.create.mockResolvedValue({ id: 'cus_123' });
    const token = await registerAndToken();

    const createRes = await request(app)
      .post('/api/billing/create-customer')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(createRes.status).toBe(200);
    expect(createRes.body.customerId).toBe('cus_123');

    const statusRes = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`);

    expect(statusRes.body.customerId).toBe('cus_123');
  });

  it('creates a subscription and upgrades the authenticated user plan', async () => {
    stripe.customers.create.mockResolvedValue({ id: 'cus_123' });
    stripe.paymentMethods.attach.mockResolvedValue({ id: 'pm_123' });
    stripe.customers.update.mockResolvedValue({ id: 'cus_123' });
    stripe.subscriptions.create.mockResolvedValue({ id: 'sub_123', status: 'active' });
    const token = await registerAndToken();

    await request(app)
      .post('/api/billing/create-customer')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const subRes = await request(app)
      .post('/api/billing/create-subscription')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethodId: 'pm_123' });

    expect(subRes.status).toBe(200);
    expect(subRes.body.subscription.id).toBe('sub_123');

    const statusRes = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`);

    expect(statusRes.body.plan).toBe('pro');
    expect(statusRes.body.subscriptionStatus).toBe('active');
  });
});
