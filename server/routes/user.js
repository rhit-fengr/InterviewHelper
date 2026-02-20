'use strict';

const express = require('express');

const router = express.Router();

/**
 * GET /api/user/profile
 * Returns the current user's profile.
 * In production, extract userId from a JWT/session token.
 */
router.get('/profile', (req, res) => {
  // Placeholder — integrate with Supabase Auth in production
  res.json({
    id: 'demo-user',
    email: 'demo@example.com',
    plan: 'free',
    createdAt: new Date().toISOString(),
  });
});

/**
 * PUT /api/user/profile
 * Update user profile / personal info.
 */
router.put('/profile', (req, res) => {
  const { personalInfo } = req.body;
  // Placeholder — persist to Supabase in production
  res.json({ updated: true, personalInfo });
});

module.exports = router;
