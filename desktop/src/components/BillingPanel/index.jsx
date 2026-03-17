import { useState, useEffect, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import {
  getBillingStatus,
  createCustomer,
  createSubscription,
  cancelSubscription,
} from '../../utils/api';
import './BillingPanel.css';

export default function BillingPanel({ onBack }) {
  const { auth } = useInterviewStore();

  const isAuthenticated = !!auth.token && !!auth.user;

  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');

  // ── Fetch billing status on mount when authenticated ──────────────────
  const fetchStatus = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true);
    setError('');
    try {
      const data = await getBillingStatus(auth.token);
      setBilling(data);
    } catch (err) {
      setError(err.message || 'Failed to load billing status');
    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStatus();
    }
  }, [isAuthenticated, fetchStatus]);

  // ── Create customer ───────────────────────────────────────────────────
  const handleCreateCustomer = useCallback(async () => {
    setActionLoading(true);
    setError('');
    try {
      const customerData = {};
      if (auth.user?.email) customerData.email = auth.user.email;
      if (auth.user?.name) customerData.name = auth.user.name;
      await createCustomer(auth.token, customerData);
      await fetchStatus();
    } catch (err) {
      setError(err.message || 'Failed to create customer');
    } finally {
      setActionLoading(false);
    }
  }, [auth.token, auth.user, fetchStatus]);

  // ── Subscribe ─────────────────────────────────────────────────────────
  const handleSubscribe = useCallback(async () => {
    if (!paymentMethodId.trim()) {
      setError('Please enter a payment method ID');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      await createSubscription(auth.token, {
        customerId: billing.customerId,
        paymentMethodId: paymentMethodId.trim(),
      });
      setPaymentMethodId('');
      await fetchStatus();
    } catch (err) {
      setError(err.message || 'Failed to create subscription');
    } finally {
      setActionLoading(false);
    }
  }, [auth.token, billing, paymentMethodId, fetchStatus]);

  // ── Cancel subscription ───────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    setActionLoading(true);
    setError('');
    try {
      await cancelSubscription(auth.token, {
        subscriptionId: billing.subscriptionId,
      });
      await fetchStatus();
    } catch (err) {
      setError(err.message || 'Failed to cancel subscription');
    } finally {
      setActionLoading(false);
    }
  }, [auth.token, billing, fetchStatus]);

  // ── Unauthenticated ───────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="billing-panel">
        <div className="panel-header">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h2 className="panel-title">Billing</h2>
        </div>
        <div className="billing-sign-in-required">
          Please sign in to manage your billing and subscription.
        </div>
      </div>
    );
  }

  // ── Loading billing status ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="billing-panel">
        <div className="panel-header">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h2 className="panel-title">Billing</h2>
        </div>
        <div className="billing-loading">Loading billing status…</div>
      </div>
    );
  }

  // ── Determine billing state ───────────────────────────────────────────
  const hasCustomer = billing && billing.customerId;
  const hasSubscription = billing && billing.subscriptionId;
  const isActive = hasSubscription && billing.subscriptionStatus === 'active';
  const isCancelAtPeriodEnd = hasSubscription && billing.subscriptionStatus === 'cancel_at_period_end';

  return (
    <div className="billing-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">Billing</h2>
      </div>

      {/* Error banner */}
      {error && (
        <div className="billing-error" role="alert">{error}</div>
      )}

      {/* Plan info when available */}
      {billing && (
        <section className="settings-section billing-status-section">
          <h3 className="section-title">Current Plan</h3>
          <div className="billing-status-row">
            <span className="billing-status-label">Plan</span>
            <span className="billing-status-value">{billing.plan || 'Free'}</span>
          </div>
          {hasCustomer && (
            <div className="billing-status-row">
              <span className="billing-status-label">Customer</span>
              <span className="billing-status-value billing-customer-id">{billing.customerId}</span>
            </div>
          )}
          {hasSubscription && (
            <>
              <div className="billing-status-row">
                <span className="billing-status-label">Status</span>
                <span className={`billing-status-value billing-sub-status billing-sub-status--${billing.subscriptionStatus}`}>
                  {billing.subscriptionStatus}
                </span>
              </div>
              <div className="billing-status-row">
                <span className="billing-status-label">Subscription</span>
                <span className="billing-status-value">{billing.subscriptionId}</span>
              </div>
            </>
          )}
        </section>
      )}

      {/* Cancel at period end notice */}
      {isCancelAtPeriodEnd && (
        <div className="billing-cancel-notice">
          Your subscription is set to cancel at the end of the current billing period.
        </div>
      )}

      {/* No customer: offer to create */}
      {billing && !hasCustomer && (
        <section className="settings-section">
          <h3 className="section-title">Get Started</h3>
          <p className="billing-hint">
            Create a billing customer to start your subscription.
          </p>
          <button
            className="btn-primary"
            onClick={handleCreateCustomer}
            disabled={actionLoading}
          >
            {actionLoading ? 'Creating…' : 'Create Customer'}
          </button>
        </section>
      )}

      {/* Customer exists, no subscription: subscribe flow */}
      {hasCustomer && !hasSubscription && (
        <section className="settings-section">
          <h3 className="section-title">Subscribe</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="billing-payment-method">
              Payment Method ID
            </label>
            <input
              id="billing-payment-method"
              className="form-input"
              placeholder="e.g. pm_card_visa"
              title="Stripe payment method ID for testing"
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
            />
            <span className="billing-hint">
              Use a Stripe test payment method ID such as <code>pm_card_visa</code>.
            </span>
          </div>
          <button
            className="btn-primary"
            onClick={handleSubscribe}
            disabled={actionLoading}
          >
            {actionLoading ? 'Subscribing…' : 'Subscribe'}
          </button>
        </section>
      )}

      {/* Active subscription: cancel option */}
      {isActive && (
        <section className="settings-section">
          <h3 className="section-title">Manage Subscription</h3>
          <button
            className="btn-secondary billing-cancel-btn"
            onClick={handleCancel}
            disabled={actionLoading}
          >
            {actionLoading ? 'Cancelling…' : 'Cancel Subscription'}
          </button>
        </section>
      )}
    </div>
  );
}
