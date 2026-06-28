import { createContext } from 'react';

export interface AuthContextType {
  accessToken: string | null;
  session: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  login: () => void;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  clearAuthError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
