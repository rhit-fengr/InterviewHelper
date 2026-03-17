const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

/**
 * Wraps fetch with JSON handling and Bearer token support.
 * Throws readable errors for non-2xx responses.
 */
async function apiCall(endpoint, options = {}) {
  const { token, ...fetchOptions } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${SERVER_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    let message = `Server error: ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(message);
  }

  return response.json();
}

export async function register({ name, email, password }) {
  return apiCall('/api/user/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function login({ email, password }) {
  return apiCall('/api/user/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getProfile(token) {
  return apiCall('/api/user/profile', {
    method: 'GET',
    token,
  });
}

export async function updateProfile(token, profileData) {
  return apiCall('/api/user/profile', {
    method: 'PUT',
    token,
    body: JSON.stringify(profileData),
  });
}

export async function getBillingStatus(token) {
  return apiCall('/api/billing/status', {
    method: 'GET',
    token,
  });
}

export async function createCustomer(token, customerData = {}) {
  return apiCall('/api/billing/create-customer', {
    method: 'POST',
    token,
    body: JSON.stringify(customerData),
  });
}

export async function createSubscription(token, { customerId, paymentMethodId }) {
  return apiCall('/api/billing/create-subscription', {
    method: 'POST',
    token,
    body: JSON.stringify({ customerId, paymentMethodId }),
  });
}

export async function cancelSubscription(token, subscriptionData = {}) {
  return apiCall('/api/billing/cancel-subscription', {
    method: 'POST',
    token,
    body: JSON.stringify(subscriptionData),
  });
}
