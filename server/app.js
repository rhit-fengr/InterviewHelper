'use strict';

const express = require('express');
const cors = require('cors');

const sessionRoutes = require('./routes/session');
const aiRoutes = require('./routes/ai');
const userRoutes = require('./routes/user');
const billingRoutes = require('./routes/billing');

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
}));

// Stripe webhook must receive raw body — register before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/session', sessionRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/user', userRoutes);
app.use('/api/billing', billingRoutes);

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
