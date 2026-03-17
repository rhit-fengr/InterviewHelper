'use strict';

const crypto = require('crypto');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const usersById = new Map();
const userIdByEmail = new Map();
const sessionsByToken = new Map();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    createdAt: user.createdAt,
    personalInfo: { ...user.personalInfo },
    billing: {
      customerId: user.billing.customerId,
      subscriptionId: user.billing.subscriptionId,
      subscriptionStatus: user.billing.subscriptionStatus,
    },
  };
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encodedHash) {
  const [salt, hash] = String(encodedHash || '').split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computed, 'hex'));
}

function createSessionToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessionsByToken.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getUserByToken(token) {
  const session = sessionsByToken.get(String(token || '').trim());
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionsByToken.delete(token);
    return null;
  }
  return usersById.get(session.userId) || null;
}

function readBearerToken(req) {
  const authHeader = String(req.headers?.authorization || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ? match[1].trim() : '';
}

function buildAuthError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function registerUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw buildAuthError('email is required', 400);
  }
  if (!String(password || '').trim()) {
    throw buildAuthError('password is required', 400);
  }
  if (String(password).length < 8) {
    throw buildAuthError('password must be at least 8 characters', 400);
  }
  if (userIdByEmail.has(normalizedEmail)) {
    throw buildAuthError('An account with this email already exists.', 409);
  }

  const id = `user_${crypto.randomBytes(8).toString('hex')}`;
  const user = {
    id,
    email: normalizedEmail,
    name: String(name || '').trim(),
    passwordHash: createPasswordHash(password),
    plan: 'free',
    createdAt: new Date().toISOString(),
    personalInfo: {},
    billing: {
      customerId: '',
      subscriptionId: '',
      subscriptionStatus: 'inactive',
    },
  };

  usersById.set(id, user);
  userIdByEmail.set(normalizedEmail, id);
  return {
    token: createSessionToken(id),
    user: sanitizeUser(user),
  };
}

function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const userId = userIdByEmail.get(normalizedEmail);
  const user = userId ? usersById.get(userId) : null;
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw buildAuthError('Invalid email or password.', 401);
  }

  return {
    token: createSessionToken(user.id),
    user: sanitizeUser(user),
  };
}

function getAuthenticatedUser(req) {
  const token = readBearerToken(req);
  const user = getUserByToken(token);
  if (!user) {
    throw buildAuthError('Authentication required.', 401);
  }
  return user;
}

function updateUserProfile(userId, { name, personalInfo }) {
  const user = usersById.get(userId);
  if (!user) {
    throw buildAuthError('User not found.', 404);
  }

  if (typeof name === 'string') {
    user.name = name.trim();
  }
  if (personalInfo && typeof personalInfo === 'object' && !Array.isArray(personalInfo)) {
    user.personalInfo = {
      ...user.personalInfo,
      ...personalInfo,
    };
  }

  usersById.set(userId, user);
  return sanitizeUser(user);
}

function updateUserBilling(userId, billingPatch = {}) {
  const user = usersById.get(userId);
  if (!user) {
    throw buildAuthError('User not found.', 404);
  }

  user.billing = {
    ...user.billing,
    ...billingPatch,
  };
  if (typeof billingPatch.plan === 'string' && billingPatch.plan.trim()) {
    user.plan = billingPatch.plan.trim();
  }
  usersById.set(userId, user);
  return sanitizeUser(user);
}

function getBillingSnapshot(userId) {
  const user = usersById.get(userId);
  if (!user) {
    throw buildAuthError('User not found.', 404);
  }
  return {
    plan: user.plan,
    customerId: user.billing.customerId,
    subscriptionId: user.billing.subscriptionId,
    subscriptionStatus: user.billing.subscriptionStatus,
  };
}

function resetAuthState() {
  usersById.clear();
  userIdByEmail.clear();
  sessionsByToken.clear();
}

module.exports = {
  getAuthenticatedUser,
  getBillingSnapshot,
  loginUser,
  registerUser,
  resetAuthState,
  sanitizeUser,
  updateUserBilling,
  updateUserProfile,
};
