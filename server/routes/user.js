'use strict';

const express = require('express');
const {
  getAuthenticatedUser,
  loginUser,
  registerUser,
  sanitizeUser,
  updateUserProfile,
} = require('../services/auth.service');

const router = express.Router();

router.post('/register', (req, res) => {
  try {
    const result = registerUser(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[user] register error:', err);
    res.status(Number(err?.status) || 500).json({ error: err?.message || 'Failed to register user.' });
  }
});

router.post('/login', (req, res) => {
  try {
    const result = loginUser(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[user] login error:', err);
    res.status(Number(err?.status) || 500).json({ error: err?.message || 'Failed to login.' });
  }
});

/**
 * GET /api/user/profile
 * Returns the current user's profile.
 */
router.get('/profile', (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    res.json(sanitizeUser(user));
  } catch (err) {
    res.status(Number(err?.status) || 500).json({ error: err?.message || 'Failed to load profile.' });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile / personal info.
 */
router.put('/profile', (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const nextUser = updateUserProfile(user.id, req.body || {});
    res.json({ updated: true, user: nextUser });
  } catch (err) {
    console.error('[user] update profile error:', err);
    res.status(Number(err?.status) || 500).json({ error: err?.message || 'Failed to update profile.' });
  }
});

module.exports = router;
