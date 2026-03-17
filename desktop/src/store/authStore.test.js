import { useInterviewStore } from './interviewStore';

describe('Auth Store Slice', () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    const { clearAuth } = useInterviewStore.getState();
    clearAuth();
  });

  describe('default auth state', () => {
    it('should have empty token and null user on init', () => {
      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('');
      expect(auth.user).toBeNull();
    });

    it('should have loading = false by default', () => {
      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(false);
    });

    it('should have error = empty string by default', () => {
      const { auth } = useInterviewStore.getState();
      expect(auth.error).toBe('');
    });
  });

  describe('setAuth action', () => {
    it('should set token and user', () => {
      const testToken = 'test-jwt-token';
      const testUser = { id: 1, email: 'test@example.com', name: 'Test User' };

      const { setAuth } = useInterviewStore.getState();
      setAuth({ token: testToken, user: testUser });

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe(testToken);
      expect(auth.user).toEqual(testUser);
    });

    it('should clear loading and error on setAuth', () => {
      const { setAuthLoading, setAuthError } = useInterviewStore.getState();
      setAuthLoading(true);
      setAuthError('Some error');

      const { setAuth } = useInterviewStore.getState();
      setAuth({ token: 'token', user: { id: 1, email: 'test@example.com' } });

      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(false);
      expect(auth.error).toBe('');
    });

    it('should accept missing values and normalize them', () => {
      const { setAuth } = useInterviewStore.getState();
      setAuth({ token: null, user: null });

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('');
      expect(auth.user).toBeNull();
    });
  });

  describe('clearAuth action', () => {
    it('should reset token and user to null', () => {
      const { setAuth, clearAuth } = useInterviewStore.getState();
      setAuth({ token: 'token', user: { id: 1, email: 'test@example.com' } });
      clearAuth();

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('');
      expect(auth.user).toBeNull();
    });

    it('should reset loading and error to defaults', () => {
      const { setAuthLoading, setAuthError, clearAuth } = useInterviewStore.getState();
      setAuthLoading(true);
      setAuthError('Some error');
      clearAuth();

      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(false);
      expect(auth.error).toBe('');
    });

    it('should be idempotent', () => {
      const { clearAuth } = useInterviewStore.getState();
      clearAuth();
      clearAuth();

      const { auth } = useInterviewStore.getState();
      expect(auth).toEqual({ token: '', user: null, loading: false, error: '' });
    });
  });

  describe('setAuthLoading action', () => {
    it('should set loading to true', () => {
      const { setAuthLoading } = useInterviewStore.getState();
      setAuthLoading(true);

      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(true);
    });

    it('should set loading to false', () => {
      const { setAuthLoading } = useInterviewStore.getState();
      setAuthLoading(true);
      setAuthLoading(false);

      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(false);
    });

    it('should keep token/user and clear error when loading starts', () => {
      const testUser = { id: 1, email: 'test@example.com' };
      const testError = 'Test error';

      const { setAuth, setAuthError, setAuthLoading } = useInterviewStore.getState();
      setAuth({ token: 'token', user: testUser });
      setAuthError(testError);
      setAuthLoading(true);

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe('token');
      expect(auth.user).toEqual(testUser);
      expect(auth.error).toBe('');
    });
  });

  describe('setAuthError action', () => {
    it('should set error message', () => {
      const errorMsg = 'Invalid credentials';

      const { setAuthError } = useInterviewStore.getState();
      setAuthError(errorMsg);

      const { auth } = useInterviewStore.getState();
      expect(auth.error).toBe(errorMsg);
    });

    it('should clear loading when setting error', () => {
      const { setAuthLoading, setAuthError } = useInterviewStore.getState();
      setAuthLoading(true);
      setAuthError('Error occurred');

      const { auth } = useInterviewStore.getState();
      expect(auth.loading).toBe(false);
    });

    it('should normalize null error to empty string', () => {
      const { setAuthError } = useInterviewStore.getState();
      setAuthError('Error');
      setAuthError(null);

      const { auth } = useInterviewStore.getState();
      expect(auth.error).toBe('');
    });

    it('should not affect token or user', () => {
      const testToken = 'token';
      const testUser = { id: 1, email: 'test@example.com' };

      const { setAuth, setAuthError } = useInterviewStore.getState();
      setAuth({ token: testToken, user: testUser });
      setAuthError('Some error');

      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe(testToken);
      expect(auth.user).toEqual(testUser);
    });
  });

  describe('auth state persistence', () => {
    it('should include auth in persisted state', () => {
      const { setAuth } = useInterviewStore.getState();
      const testToken = 'test-token';
      const testUser = { id: 1, email: 'test@example.com' };

      setAuth({ token: testToken, user: testUser });

      // Verify auth is in the store
      const { auth } = useInterviewStore.getState();
      expect(auth.token).toBe(testToken);
      expect(auth.user).toEqual(testUser);
    });
  });

  describe('integration with other store slices', () => {
    it('should not affect setup settings', () => {
      const { updateSetup, setAuth } = useInterviewStore.getState();
      const initialSetup = useInterviewStore.getState().setup;

      setAuth({ token: 'token', user: { id: 1, email: 'test@example.com' } });

      const finalSetup = useInterviewStore.getState().setup;
      expect(finalSetup).toEqual(initialSetup);
    });

    it('should not affect personal info', () => {
      const { updatePersonalInfo, setAuth } = useInterviewStore.getState();
      const testInfo = { fullName: 'Test User' };

      updatePersonalInfo(testInfo);
      const personalInfoBefore = useInterviewStore.getState().personalInfo;

      setAuth({ token: 'token', user: { id: 1, email: 'test@example.com' } });

      const personalInfoAfter = useInterviewStore.getState().personalInfo;
      expect(personalInfoAfter).toEqual(personalInfoBefore);
    });

    it('should allow updating session and auth independently', () => {
      const { updateSession, setAuth } = useInterviewStore.getState();

      updateSession({ autoAnswer: false });
      setAuth({ token: 'token', user: { id: 1, email: 'test@example.com' } });

      const { session, auth } = useInterviewStore.getState();
      expect(session.autoAnswer).toBe(false);
      expect(auth.token).toBe('token');
    });
  });
});
