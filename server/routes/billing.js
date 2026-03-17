'use strict';

const express = require('express');
const {
  getAuthenticatedUser,
  getBillingSnapshot,
  updateUserBilling,
} = require('../services/auth.service');

/**
 * True when Stripe is fully configured; false otherwise.
 * Billing routes return 503 immediately when not configured.
 */
const isConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

if (!isConfigured) {
  console.warn('[billing] WARNING: STRIPE_SECRET_KEY is not set. Billing endpoints will return 503 until configured.');
}
if (!process.env.STRIPE_PRICE_ID) {
  console.warn('[billing] WARNING: STRIPE_PRICE_ID is not set. Subscription creation will return 503 until configured.');
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

const MONTHLY_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_placeholder';

router.get('/status', (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    res.json(getBillingSnapshot(user.id));
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ error: err?.message || 'Failed to load billing status.' });
  }
});

/**
 * POST /api/billing/create-customer
 * Creates a Stripe customer for the user.
 */
router.post('/create-customer', async (req, res) => {
  if (!isConfigured) {
    return res.status(503).json({ error: 'Billing service is not configured. Set STRIPE_SECRET_KEY.' });
  }

  let user;
  try {
    user = getAuthenticatedUser(req);
  } catch (err) {
    return res.status(Number(err?.status) || 500).json({ error: err?.message || 'Authentication required.' });
  }

  const email = String(req.body?.email || user.email || '').trim();
  const name = String(req.body?.name || user.name || '').trim();

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const customer = await stripe.customers.create({ email, name });
    updateUserBilling(user.id, {
      customerId: customer.id,
    });
    res.json({ customerId: customer.id });
  } catch (err) {
    console.error('[billing] create-customer error:', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

/**
 * POST /api/billing/create-subscription
 * Creates a $30/month subscription for the customer.
 */
router.post('/create-subscription', async (req, res) => {
  if (!isConfigured || !process.env.STRIPE_PRICE_ID) {
    return res.status(503).json({ error: 'Billing service is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.' });
  }

  let user;
  try {
    user = getAuthenticatedUser(req);
  } catch (err) {
    return res.status(Number(err?.status) || 500).json({ error: err?.message || 'Authentication required.' });
  }

  const customerId = String(req.body?.customerId || user.billing?.customerId || '').trim();
  const paymentMethodId = String(req.body?.paymentMethodId || '').trim();

  if (!customerId || !paymentMethodId) {
    return res.status(400).json({ error: 'customerId and paymentMethodId are required' });
  }

  try {
    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: MONTHLY_PRICE_ID }],
      expand: ['latest_invoice.payment_intent'],
    });

    updateUserBilling(user.id, {
      customerId,
      subscriptionId: subscription.id,
      subscriptionStatus: String(subscription.status || 'active'),
      plan: String(subscription.status || '').toLowerCase() === 'active' ? 'pro' : 'free',
    });

    res.json({ subscription });
  } catch (err) {
    console.error('[billing] create-subscription error:', err);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

/**
 * POST /api/billing/cancel-subscription
 * Cancels a subscription at period end.
 */
router.post('/cancel-subscription', async (req, res) => {
  if (!isConfigured) {
    return res.status(503).json({ error: 'Billing service is not configured. Set STRIPE_SECRET_KEY.' });
  }

  let user;
  try {
    user = getAuthenticatedUser(req);
  } catch (err) {
    return res.status(Number(err?.status) || 500).json({ error: err?.message || 'Authentication required.' });
  }

  const subscriptionId = String(req.body?.subscriptionId || user.billing?.subscriptionId || '').trim();

  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId is required' });
  }

  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    updateUserBilling(user.id, {
      subscriptionId,
      subscriptionStatus: 'cancel_at_period_end',
      plan: 'free',
    });
    res.json({ subscription });
  } catch (err) {
    console.error('[billing] cancel-subscription error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook handler. Raw body is parsed by app.js before this route.
 */
router.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).json({ received: true });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[billing] webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  switch (event.type) {
    case 'customer.subscription.deleted':
      // Handle subscription cancellation — update DB
      break;
    case 'invoice.payment_succeeded':
      // Renew access
      break;
    default:
      break;
  }

  res.json({ received: true });
});

module.exports = router;
