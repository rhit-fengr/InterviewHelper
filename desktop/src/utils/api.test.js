import {
  register,
  login,
  getProfile,
  updateProfile,
  getBillingStatus,
  createCustomer,
  createSubscription,
  cancelSubscription,
} from './api';

// Mock fetch globally
global.fetch = jest.fn();

describe('API client', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('register', () => {
    it('sends registration request with name, email, password', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '123', email: 'test@example.com' }, token: 'abc' }),
      });

      const result = await register({ name: 'John Doe', email: 'john@example.com', password: 'password123' });

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John Doe', email: 'john@example.com', password: 'password123' }),
      });
      expect(result.token).toBe('abc');
    });

    it('throws error on non-2xx response', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Email already exists' }),
      });

      await expect(register({ name: 'Jane', email: 'jane@example.com', password: 'pass' })).rejects.toThrow('Email already exists');
    });

    it('throws generic error if response is non-2xx but lacks error field', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(register({ name: 'Jane', email: 'jane@example.com', password: 'pass' })).rejects.toThrow('Server error: 500');
    });

    it('throws generic error if response JSON fails to parse', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(register({ name: 'Jane', email: 'jane@example.com', password: 'pass' })).rejects.toThrow('Server error: 500');
    });
  });

  describe('login', () => {
    it('sends login request with email and password', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '123', email: 'test@example.com' }, token: 'xyz789' }),
      });

      const result = await login({ email: 'test@example.com', password: 'password123' });

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      });
      expect(result.token).toBe('xyz789');
    });

    it('throws error on invalid credentials', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid email or password' }),
      });

      await expect(login({ email: 'test@example.com', password: 'wrongpassword' })).rejects.toThrow('Invalid email or password');
    });
  });

  describe('getProfile', () => {
    it('includes Bearer token in Authorization header', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '123', name: 'John', email: 'john@example.com' } }),
      });

      await getProfile('token123');

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/user/profile', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
      });
    });

    it('throws error if not authenticated (401)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(getProfile('invalidtoken')).rejects.toThrow('Unauthorized');
    });
  });

  describe('updateProfile', () => {
    it('sends PUT request with profile data and token', async () => {
      const profileData = {
        name: 'Jane Doe',
        personalInfo: { fullName: 'Jane Doe', skills: 'React' },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { ...profileData, id: '123' } }),
      });

      await updateProfile('token123', profileData);

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
        body: JSON.stringify(profileData),
      });
    });
  });

  describe('getBillingStatus', () => {
    it('fetches billing status with token', async () => {
      const billingStatus = { customerId: 'cus_123', subscriptionId: '', subscriptionStatus: 'inactive', plan: 'free' };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => billingStatus,
      });

      const result = await getBillingStatus('token123');

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/billing/status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
      });
      expect(result.customerId).toBe('cus_123');
    });
  });

  describe('createCustomer', () => {
    it('sends POST request to create customer', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ customerId: 'cus_456' }),
      });

      const result = await createCustomer('token123', { email: 'john@example.com', name: 'John Doe' });

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/billing/create-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
        body: JSON.stringify({ email: 'john@example.com', name: 'John Doe' }),
      });
      expect(result.customerId).toBe('cus_456');
    });
  });

  describe('createSubscription', () => {
    it('sends subscription request with paymentMethodId', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscription: { id: 'sub_789', status: 'active' } }),
      });

      const result = await createSubscription('token123', { customerId: 'cus_456', paymentMethodId: 'pm_card_visa' });

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/billing/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
        body: JSON.stringify({ customerId: 'cus_456', paymentMethodId: 'pm_card_visa' }),
      });
      expect(result.subscription.status).toBe('active');
    });
  });

  describe('cancelSubscription', () => {
    it('sends POST request to cancel subscription', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscription: { id: 'sub_789', status: 'canceled' } }),
      });

      const result = await cancelSubscription('token123', { subscriptionId: 'sub_789' });

      expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/billing/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
        body: JSON.stringify({ subscriptionId: 'sub_789' }),
      });
      expect(result.subscription.status).toBe('canceled');
    });
  });

  describe('auth header behavior', () => {
    it('does not include Authorization header when token is not provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '123' } }),
      });

      await login({ email: 'test@example.com', password: 'password' });

      const callArgs = fetch.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });

    it('includes Authorization header with Bearer prefix when token is provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '123' } }),
      });

      await getProfile('mytoken');

      const callArgs = fetch.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBe('Bearer mytoken');
    });
  });

  describe('error handling', () => {
    it('throws network error if fetch throws', async () => {
      fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(login({ email: 'test@example.com', password: 'password' })).rejects.toThrow('Failed to fetch');
    });

    it('preserves error message when response lacks JSON body', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('No JSON');
        },
      });

      await expect(login({ email: 'test@example.com', password: 'password' })).rejects.toThrow('Server error: 503');
    });
  });
});
