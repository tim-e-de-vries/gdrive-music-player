import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthValue, setAuthValue, deleteAuthValue } from '../utils/db';

interface AuthContextType {
  accessToken: string | null;
  session: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Redirect to Google OAuth Consent Screen
  const login = () => {
    window.location.href = `${BACKEND_URL}/api/auth/google`;
  };

  // Logout and clear IndexedDB
  const logout = useCallback(async () => {
    setAccessToken(null);
    setSession(null);
    setExpiresAt(null);
    await deleteAuthValue('access_token');
    await deleteAuthValue('session');
    await deleteAuthValue('expires_at');
  }, []);

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

      if (!response.ok) {
        throw new Error('Failed to refresh token from server');
      }

      const data = await response.json();
      const newAccessToken = data.access_token;
      // Google expiry date is an absolute timestamp (ms since epoch)
      const newExpiresAt = Number(data.expires_at);

      setAccessToken(newAccessToken);
      setExpiresAt(newExpiresAt);

      await setAuthValue('access_token', newAccessToken);
      await setAuthValue('expires_at', newExpiresAt);

      return newAccessToken;
    } catch (err) {
      console.error('Failed to silently refresh token:', err);
      // If refresh fails due to network/server, we do not log out immediately
      // only on explicit authorization failures (e.g. 401/403)
      return null;
    }
  }, [session, logout]);

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
        login,
        logout,
        refreshAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
