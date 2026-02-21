'use strict';

const express = require('express');
const cors = require('cors');

const sessionRoutes = require('./routes/session');
const aiRoutes = require('./routes/ai');
const userRoutes = require('./routes/user');
const billingRoutes = require('./routes/billing');

/**
 * Parse CORS_ORIGIN env var into a value accepted by the `cors` package.
 * Supports a single origin, a comma-separated list, or '*'.
 */
function parseCorsOrigin(raw) {
  if (!raw || !raw.trim()) return '*';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '*';
  return parts.length === 1 ? parts[0] : parts;
}

const app = express();

app.use(cors({ origin: parseCorsOrigin(process.env.CORS_ORIGIN) }));

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
