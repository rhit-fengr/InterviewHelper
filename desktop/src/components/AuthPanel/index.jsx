import { useState, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { login, register } from '../../utils/api';
import './AuthPanel.css';

export default function AuthPanel({ onBack, onBilling }) {
  const {
    auth,
    setAuth,
    clearAuth,
    setAuthLoading,
    setAuthError,
  } = useInterviewStore();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isAuthenticated = !!auth.token && !!auth.user;

  const resetForm = useCallback(() => {
    setName('');
    setEmail('');
    setPassword('');
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
    setAuthError('');
  }, [setAuthError]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setAuthLoading(true);

    try {
      let result;
      if (mode === 'signup') {
        result = await register({ name, email, password });
      } else {
        result = await login({ email, password });
      }
      setAuth({ token: result.token, user: result.user });
      resetForm();
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
    }
  }, [mode, name, email, password, setAuth, setAuthLoading, setAuthError, resetForm]);

  const handleSignOut = useCallback(() => {
    clearAuth();
    resetForm();
  }, [clearAuth, resetForm]);

  // ── Authenticated view ──────────────────────────────────────────────────
  if (isAuthenticated) {
    return (
      <div className="auth-panel">
        <div className="panel-header">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h2 className="panel-title">Account</h2>
        </div>

        <section className="settings-section auth-account-summary">
          <h3 className="section-title">Signed In</h3>
          <div className="auth-user-info">
            <span className="auth-user-name">{auth.user.name || auth.user.email}</span>
            <span className="auth-user-email">{auth.user.email}</span>
          </div>
        </section>

        <button className="btn-primary" onClick={onBilling}>
          Manage Billing
        </button>

        <button className="btn-secondary" onClick={handleSignOut}>
          Sign Out
        </button>
      </div>
    );
  }

  // ── Unauthenticated view (login / signup) ───────────────────────────────
  return (
    <div className="auth-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <div className="form-group">
            <label className="form-label" htmlFor="auth-name">Name</label>
            <input
              id="auth-name"
              className="form-input"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            className="form-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            className="form-input"
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </div>

        {auth.error && (
          <div className="auth-error" role="alert">{auth.error}</div>
        )}

        <button
          className="btn-primary"
          type="submit"
          disabled={auth.loading}
        >
          {auth.loading
            ? 'Please wait...'
            : mode === 'login'
              ? 'Sign In'
              : 'Create Account'}
        </button>
      </form>

      <button className="btn-link auth-mode-toggle" onClick={toggleMode}>
        {mode === 'login'
          ? "Don't have an account? Sign Up"
          : 'Already have an account? Sign In'}
      </button>
    </div>
  );
}
