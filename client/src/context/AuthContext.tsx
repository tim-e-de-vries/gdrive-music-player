import React, { useState, useEffect, useCallback } from 'react';
import { AuthContext } from './AuthContextCore';
import { getAuthValue, setAuthValue, deleteAuthValue } from '../utils/db';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Redirect to Google OAuth Consent Screen
  const login = () => {
    setAuthError(null);
    window.location.href = `${BACKEND_URL}/api/auth/google`;
  };

  // Logout and clear IndexedDB
  const logout = useCallback(async () => {
    setAccessToken(null);
    setSession(null);
    setExpiresAt(null);
    setAuthError(null);
    await deleteAuthValue('access_token');
    await deleteAuthValue('session');
    await deleteAuthValue('expires_at');
  }, []);

  const requireLogin = useCallback(async (message = 'Your Google session expired. Sign in again to continue streaming.') => {
    await logout();
    setAuthError(message);
  }, [logout]);

  // Perform a silent refresh of the Google OAuth Access Token
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const currentSession = session || (await getAuthValue<string>('session'));
    if (!currentSession) {
      await logout();
      return null;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session: currentSession }),
      });

      if (response.status === 401 || response.status === 403) {
        await requireLogin('Your Google session expired. Sign in again to continue.');
        return null;
      }

      if (!response.ok) {
        setAuthError('Could not refresh your Google session. Check your connection and try again.');
        throw new Error(`Failed to refresh token from server. Status: ${response.status}`);
      }

      const data = await response.json();
      const newAccessToken = data.access_token;
      // Google expiry date is an absolute timestamp (ms since epoch)
      const newExpiresAt = Number(data.expires_at);

      setAccessToken(newAccessToken);
      setExpiresAt(newExpiresAt);
      setAuthError(null);

      await setAuthValue('access_token', newAccessToken);
      await setAuthValue('expires_at', newExpiresAt);

      return newAccessToken;
    } catch (err) {
      console.error('Failed to silently refresh token:', err);
      // If refresh fails due to network/server, we do not log out immediately
      // only on explicit authorization failures (e.g. 401/403)
      return null;
    }
  }, [session, logout, requireLogin]);

  useEffect(() => {
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'AUTH_REQUIRED') {
        requireLogin('Google Drive access was denied. Sign in again to reconnect your library.');
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, [requireLogin]);

  // Load existing credentials from IndexedDB on startup
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedAccessToken = await getAuthValue<string>('access_token');
        const storedSession = await getAuthValue<string>('session');
        const storedExpiresAt = await getAuthValue<number>('expires_at');

        if (storedAccessToken && storedSession && storedExpiresAt) {
          setAccessToken(storedAccessToken);
          setSession(storedSession);
          setExpiresAt(storedExpiresAt);

          const timeRemaining = storedExpiresAt - Date.now();
          // If expired or expiring in less than 5 minutes, refresh immediately
          if (timeRemaining < 5 * 60 * 1000) {
            await refreshAccessToken();
          }
        }
      } catch (err) {
        console.error('Error restoring auth state from IndexedDB:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [refreshAccessToken]);

  // Handle automatic silent refreshing before token expiration
  useEffect(() => {
    if (!expiresAt || !session) return;

    const timeRemaining = expiresAt - Date.now();
    // Schedule refresh 5 minutes before expiration
    const refreshDelay = Math.max(0, timeRemaining - 5 * 60 * 1000);

    const timer = setTimeout(() => {
      refreshAccessToken();
    }, refreshDelay);

    return () => clearTimeout(timer);
  }, [expiresAt, session, refreshAccessToken]);

  const isAuthenticated = !!accessToken;

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        session,
        isAuthenticated,
        isLoading,
        authError,
        login,
        logout,
        refreshAccessToken,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
