import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInterviewStore } from '../../store/interviewStore';

// Enable act() environment for React 18 concurrent mode
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── Mock API module ─────────────────────────────────────────────────────────
jest.mock('../../utils/api', () => ({
  getBillingStatus: jest.fn(),
  createCustomer: jest.fn(),
  createSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
}));

const api = require('../../utils/api');

// Lazy-import component AFTER mocks are set
let BillingPanel;
beforeAll(() => {
  BillingPanel = require('./index').default;
});

// ── DOM helpers ─────────────────────────────────────────────────────────────
let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  // Reset store auth to defaults
  useInterviewStore.getState().clearAuth();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  root = null;
});

function render(ui) {
  act(() => root.render(ui));
}

function text() {
  return container.textContent;
}

function query(selector) {
  return container.querySelector(selector);
}

function queryAll(selector) {
  return Array.from(container.querySelectorAll(selector));
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function changeValue(el, value) {
  act(() => {
    // eslint-disable-next-line no-param-reassign
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ── Helper to set authenticated state ───────────────────────────────────────
function authenticateStore(overrides = {}) {
  const { setAuth } = useInterviewStore.getState();
  setAuth({
    token: 'test-token',
    user: { id: '1', email: 'test@example.com', name: 'Test User', ...overrides },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('BillingPanel', () => {
  // ── Unauthenticated state ──────────────────────────────────────────────
  describe('unauthenticated', () => {
    it('shows sign-in-required message when not authenticated', () => {
      render(<BillingPanel onBack={jest.fn()} />);

      expect(text()).toContain('Please sign in');
      expect(text()).toContain('billing');
    });

    it('renders back button in unauthenticated state', () => {
      const onBack = jest.fn();
      render(<BillingPanel onBack={onBack} />);

      const backBtn = query('.btn-back');
      expect(backBtn).not.toBeNull();
      click(backBtn);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('does not fetch billing status when unauthenticated', () => {
      render(<BillingPanel onBack={jest.fn()} />);

      expect(api.getBillingStatus).not.toHaveBeenCalled();
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────
  describe('loading', () => {
    it('shows loading indicator while fetching billing status', async () => {
      let resolveStatus;
      api.getBillingStatus.mockImplementation(
        () => new Promise((resolve) => { resolveStatus = resolve; }),
      );

      authenticateStore();
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('Loading billing status');

      // Resolve so the promise settles
      await act(async () => {
        resolveStatus({ plan: 'free', customerId: '', subscriptionId: '', subscriptionStatus: '' });
      });
    });
  });

  // ── No Stripe customer ────────────────────────────────────────────────
  describe('no customer', () => {
    beforeEach(async () => {
      api.getBillingStatus.mockResolvedValue({
        plan: 'free',
        customerId: '',
        subscriptionId: '',
        subscriptionStatus: '',
      });

      authenticateStore();
    });

    it('shows create customer action when no customer exists', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('Create Customer');
      expect(text()).toContain('free');
    });

    it('creates customer using auth user email and name', async () => {
      api.createCustomer.mockResolvedValue({ customerId: 'cus_new' });
      // Re-mock to return customer after creation
      api.getBillingStatus
        .mockResolvedValueOnce({ plan: 'free', customerId: '', subscriptionId: '', subscriptionStatus: '' })
        .mockResolvedValueOnce({ plan: 'free', customerId: 'cus_new', subscriptionId: '', subscriptionStatus: '' });

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const createBtn = queryAll('button').find((b) => b.textContent.includes('Create Customer') || b.textContent.includes('Creating'));
      expect(createBtn).toBeDefined();

      await act(async () => {
        click(createBtn);
      });

      expect(api.createCustomer).toHaveBeenCalledWith('test-token', {
        email: 'test@example.com',
        name: 'Test User',
      });
    });

    it('shows error when create customer fails', async () => {
      api.createCustomer.mockRejectedValue(new Error('Stripe not configured'));

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const createBtn = queryAll('button').find((b) => b.textContent.includes('Create Customer'));
      await act(async () => {
        click(createBtn);
      });

      expect(text()).toContain('Stripe not configured');
    });
  });

  // ── Customer exists, no subscription ──────────────────────────────────
  describe('customer exists, no subscription', () => {
    beforeEach(async () => {
      api.getBillingStatus.mockResolvedValue({
        plan: 'free',
        customerId: 'cus_123',
        subscriptionId: '',
        subscriptionStatus: '',
      });

      authenticateStore();
    });

    it('shows subscribe form with payment method input', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const input = query('#billing-payment-method');
      expect(input).not.toBeNull();
      expect(input.getAttribute('title')).toContain('payment method');
      expect(text()).toContain('Subscribe');
      expect(text()).toContain('pm_card_visa');
    });

    it('shows error when subscribing with empty payment method', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const subscribeBtn = queryAll('button').find((b) => b.textContent === 'Subscribe');
      await act(async () => {
        click(subscribeBtn);
      });

      expect(text()).toContain('Please enter a payment method ID');
      expect(api.createSubscription).not.toHaveBeenCalled();
    });

    it('subscribes with provided payment method ID', async () => {
      api.createSubscription.mockResolvedValue({
        subscription: { id: 'sub_new', status: 'active' },
      });
      api.getBillingStatus
        .mockResolvedValueOnce({ plan: 'free', customerId: 'cus_123', subscriptionId: '', subscriptionStatus: '' })
        .mockResolvedValueOnce({ plan: 'pro', customerId: 'cus_123', subscriptionId: 'sub_new', subscriptionStatus: 'active' });

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const input = query('#billing-payment-method');
      changeValue(input, 'pm_card_visa');

      const subscribeBtn = queryAll('button').find((b) => b.textContent === 'Subscribe');
      await act(async () => {
        click(subscribeBtn);
      });

      expect(api.createSubscription).toHaveBeenCalledWith('test-token', {
        customerId: 'cus_123',
        paymentMethodId: 'pm_card_visa',
      });
    });

    it('shows error when subscription fails', async () => {
      api.createSubscription.mockRejectedValue(new Error('Payment declined'));

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const input = query('#billing-payment-method');
      changeValue(input, 'pm_card_visa');

      const subscribeBtn = queryAll('button').find((b) => b.textContent === 'Subscribe');
      await act(async () => {
        click(subscribeBtn);
      });

      expect(text()).toContain('Payment declined');
    });

    it('shows customer ID in status section', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('cus_123');
    });
  });

  // ── Active subscription ───────────────────────────────────────────────
  describe('active subscription', () => {
    beforeEach(async () => {
      api.getBillingStatus.mockResolvedValue({
        plan: 'pro',
        customerId: 'cus_123',
        subscriptionId: 'sub_789',
        subscriptionStatus: 'active',
      });

      authenticateStore();
    });

    it('shows plan and subscription status', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('pro');
      expect(text()).toContain('active');
      expect(text()).toContain('sub_789');
    });

    it('shows cancel subscription button', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const cancelBtn = queryAll('button').find((b) => b.textContent.includes('Cancel Subscription'));
      expect(cancelBtn).toBeDefined();
    });

    it('cancels subscription on click', async () => {
      api.cancelSubscription.mockResolvedValue({
        subscription: { id: 'sub_789', status: 'canceled' },
      });
      api.getBillingStatus
        .mockResolvedValueOnce({ plan: 'pro', customerId: 'cus_123', subscriptionId: 'sub_789', subscriptionStatus: 'active' })
        .mockResolvedValueOnce({ plan: 'pro', customerId: 'cus_123', subscriptionId: 'sub_789', subscriptionStatus: 'cancel_at_period_end' });

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const cancelBtn = queryAll('button').find((b) => b.textContent.includes('Cancel Subscription'));
      await act(async () => {
        click(cancelBtn);
      });

      expect(api.cancelSubscription).toHaveBeenCalledWith('test-token', {
        subscriptionId: 'sub_789',
      });
    });

    it('shows error when cancel fails', async () => {
      api.cancelSubscription.mockRejectedValue(new Error('Already cancelled'));

      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const cancelBtn = queryAll('button').find((b) => b.textContent.includes('Cancel Subscription'));
      await act(async () => {
        click(cancelBtn);
      });

      expect(text()).toContain('Already cancelled');
    });

    it('does not show subscribe form when active', async () => {
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      const input = query('#billing-payment-method');
      expect(input).toBeNull();
    });
  });

  // ── Cancel at period end state ────────────────────────────────────────
  describe('cancel at period end', () => {
    it('shows cancellation notice', async () => {
      api.getBillingStatus.mockResolvedValue({
        plan: 'pro',
        customerId: 'cus_123',
        subscriptionId: 'sub_789',
        subscriptionStatus: 'cancel_at_period_end',
      });

      authenticateStore();
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('cancel at the end of the current billing period');
    });
  });

  // ── Billing status fetch error ────────────────────────────────────────
  describe('billing status error', () => {
    it('shows error when billing status fetch fails', async () => {
      api.getBillingStatus.mockRejectedValue(new Error('Billing service unavailable'));

      authenticateStore();
      await act(async () => {
        render(<BillingPanel onBack={jest.fn()} />);
      });

      expect(text()).toContain('Billing service unavailable');
    });
  });

  // ── Back button ───────────────────────────────────────────────────────
  describe('navigation', () => {
    it('calls onBack when back button is clicked', async () => {
      api.getBillingStatus.mockResolvedValue({
        plan: 'free',
        customerId: '',
        subscriptionId: '',
        subscriptionStatus: '',
      });

      const onBack = jest.fn();
      authenticateStore();
      await act(async () => {
        render(<BillingPanel onBack={onBack} />);
      });

      const backBtn = query('.btn-back');
      click(backBtn);
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });
});
