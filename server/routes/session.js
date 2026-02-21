'use strict';

const express = require('express');

const router = express.Router();

/** Active sessions stored in memory. In production, use a database. */
const activeSessions = new Map();

/**
 * POST /api/session/create
 * Creates a new interview session record.
 */
router.post('/create', (req, res) => {
  const { userId, setup } = req.body;
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  activeSessions.set(sessionId, {
    sessionId,
    userId,
    setup,
    createdAt: new Date().toISOString(),
    status: 'active',
  });

  res.json({ sessionId });
});

/**
 * GET /api/session/:sessionId
 * Returns session details.
 */
router.get('/:sessionId', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

/**
 * DELETE /api/session/:sessionId
 * Ends a session.
 */
router.delete('/:sessionId', (req, res) => {
  const deleted = activeSessions.delete(req.params.sessionId);
  if (!deleted) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ message: 'Session ended' });
});

module.exports = router;
