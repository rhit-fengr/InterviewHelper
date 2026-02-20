'use strict';

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

const MONTHLY_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_placeholder';

/**
 * POST /api/billing/create-customer
 * Creates a Stripe customer for the user.
 */
router.post('/create-customer', async (req, res) => {
  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const customer = await stripe.customers.create({ email, name });
    res.json({ customerId: customer.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/create-subscription
 * Creates a $30/month subscription for the customer.
 */
router.post('/create-subscription', async (req, res) => {
  const { customerId, paymentMethodId } = req.body;

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

    res.json({ subscription });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/cancel-subscription
 * Cancels a subscription at period end.
 */
router.post('/cancel-subscription', async (req, res) => {
  const { subscriptionId } = req.body;

  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId is required' });
  }

  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    res.json({ subscription });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
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
