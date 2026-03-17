import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInterviewStore } from '../../store/interviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../utils/api', () => ({
  login: jest.fn(),
  register: jest.fn(),
}));

const api = require('../../utils/api');

let AuthPanel;
beforeAll(() => {
  AuthPanel = require('./index').default;
});

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
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
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function authenticateStore(overrides = {}) {
  const { setAuth } = useInterviewStore.getState();
  setAuth({
    token: 'jwt-valid',
    user: { id: '1', email: 'user@example.com', name: 'Jane Doe', ...overrides },
  });
}

describe('AuthPanel', () => {
  const onBack = jest.fn();
  const onBilling = jest.fn();

  function renderPanel(props = {}) {
    render(<AuthPanel onBack={onBack} onBilling={onBilling} {...props} />);
  }

  describe('login mode', () => {
    it('renders login fields by default', () => {
      renderPanel();

      expect(text()).toContain('Sign In');
      expect(query('#auth-email')).not.toBeNull();
      expect(query('#auth-password')).not.toBeNull();
      expect(query('#auth-name')).toBeNull();
      expect(text()).toContain("Don't have an account? Sign Up");
    });

    it('calls onBack when back button is clicked', () => {
      renderPanel();

      click(query('.btn-back'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('signup mode', () => {
    it('switches to signup mode and back', () => {
      renderPanel();

      click(query('.auth-mode-toggle'));
      expect(text()).toContain('Create Account');
      expect(query('#auth-name')).not.toBeNull();
      expect(text()).toContain('Already have an account? Sign In');

      click(query('.auth-mode-toggle'));
      expect(text()).toContain('Sign In');
      expect(query('#auth-name')).toBeNull();
    });
  });

  describe('login submission', () => {
    it('calls api.login with email and password', async () => {
      api.login.mockResolvedValueOnce({
        token: 'jwt-123',
        user: { id: '1', email: 'test@example.com', name: 'Test' },
      });

      renderPanel();
      changeValue(query('#auth-email'), 'test@example.com');
      changeValue(query('#auth-password'), 'secret');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      expect(api.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'secret',
      });
    });

    it('stores token and user after successful login', async () => {
      api.login.mockResolvedValueOnce({
        token: 'jwt-123',
        user: { id: '1', email: 'test@example.com', name: 'Test' },
      });

      renderPanel();
      changeValue(query('#auth-email'), 'test@example.com');
      changeValue(query('#auth-password'), 'secret');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('jwt-123');
      expect(auth.user).toEqual({ id: '1', email: 'test@example.com', name: 'Test' });
    });

    it('shows inline error on failed login', async () => {
      api.login.mockRejectedValueOnce(new Error('Invalid email or password'));

      renderPanel();
      changeValue(query('#auth-email'), 'bad@example.com');
      changeValue(query('#auth-password'), 'wrong');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      expect(text()).toContain('Invalid email or password');
      expect(query('[role="alert"]')).not.toBeNull();
    });
  });

  describe('signup submission', () => {
    it('calls api.register with name, email, password', async () => {
      api.register.mockResolvedValueOnce({
        token: 'jwt-new',
        user: { id: '2', email: 'new@example.com', name: 'New User' },
      });

      renderPanel();
      click(query('.auth-mode-toggle'));
      changeValue(query('#auth-name'), 'New User');
      changeValue(query('#auth-email'), 'new@example.com');
      changeValue(query('#auth-password'), 'pass12345');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      expect(api.register).toHaveBeenCalledWith({
        name: 'New User',
        email: 'new@example.com',
        password: 'pass12345',
      });
    });

    it('stores token and user after successful signup', async () => {
      api.register.mockResolvedValueOnce({
        token: 'jwt-new',
        user: { id: '2', email: 'new@example.com', name: 'New User' },
      });

      renderPanel();
      click(query('.auth-mode-toggle'));
      changeValue(query('#auth-name'), 'New User');
      changeValue(query('#auth-email'), 'new@example.com');
      changeValue(query('#auth-password'), 'pass12345');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('jwt-new');
      expect(auth.user.name).toBe('New User');
    });
  });

  describe('authenticated state', () => {
    beforeEach(() => {
      authenticateStore();
    });

    it('renders account summary and actions', () => {
      renderPanel();

      expect(text()).toContain('Account');
      expect(text()).toContain('Jane Doe');
      expect(text()).toContain('user@example.com');
      expect(text()).toContain('Manage Billing');
      expect(text()).toContain('Sign Out');
    });

    it('falls back to email when name is empty', () => {
      useInterviewStore.getState().clearAuth();
      authenticateStore({ email: 'noname@example.com', name: '' });

      renderPanel();
      expect(query('.auth-user-name').textContent).toBe('noname@example.com');
    });

    it('calls onBilling and clears auth on sign out', () => {
      renderPanel();

      const buttons = queryAll('button');
      click(buttons.find((button) => button.textContent.includes('Manage Billing')));
      expect(onBilling).toHaveBeenCalledTimes(1);

      click(buttons.find((button) => button.textContent.includes('Sign Out')));
      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('');
      expect(auth.user).toBeNull();
      expect(query('#auth-email')).not.toBeNull();
    });
  });

  describe('error reset on mode toggle', () => {
    it('clears auth error when switching modes', async () => {
      api.login.mockRejectedValueOnce(new Error('Bad creds'));

      renderPanel();
      changeValue(query('#auth-email'), 'a@b.com');
      changeValue(query('#auth-password'), 'secret');

      await act(async () => {
        click(query('button[type="submit"]'));
      });

      expect(query('[role="alert"]')).not.toBeNull();
      click(query('.auth-mode-toggle'));
      expect(query('[role="alert"]')).toBeNull();
    });
  });
});
