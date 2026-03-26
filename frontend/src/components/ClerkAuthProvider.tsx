import React, { useState, useEffect } from 'react';
import { useUser, useAuth, useOrganization, ClerkProvider } from '@clerk/clerk-react';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import * as Sentry from '@sentry/react';
import { offlineSyncService } from '../lib/offline-sync';

interface ClerkAuthProviderProps {
  children: React.ReactNode;
  publishableKey: string;
}

const decodeTokenAndGetRole = (token: string | null): 'Manager' | 'Team Member' | null => {
  if (!token) return null;
  try {
    const decodedToken = jwtDecode<JwtPayload & { role?: string }>(token);
    const role = decodedToken.role;
    if (role === 'Manager') {
      return 'Manager';
    } else if (role === 'Team Member') {
      return 'Team Member';
    }
    return 'Team Member'; // Default role
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return 'Team Member';
  }
};

const decodeTokenAndGetUserId = (token: string | null): number | null => {
  if (!token) return null;
  try {
    const decodedToken = jwtDecode<JwtPayload & { userId?: number }>(token);
    return typeof decodedToken.userId === 'number' ? decodedToken.userId : null;
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return null;
  }
};

const decodeTokenAndGetUserName = (token: string | null): string | null => {
  if (!token) return null;
  try {
    const decodedToken = jwtDecode<JwtPayload & { name?: string; email?: string }>(token);
    return decodedToken.name || decodedToken.email || null;
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return null;
  }
};

// Auth context to share auth state
interface AuthContextType {
  isLoggedIn: boolean;
  isFullySignedIn: boolean;
  hasOrganization: boolean;
  token: string | null;
  userId: number | null;
  userName: string | null;
  userRole: 'Manager' | 'Team Member' | null;
  handleLogin: (token: string) => void;
  handleLogout: () => void;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within ClerkAuthProvider');
  }
  return context;
};

// Inner component that uses Clerk hooks
function ClerkAuthInner({ children }: { children: React.ReactNode }) {
  const { isSignedIn, user, isLoaded } = useUser();
  const { getToken, signOut } = useAuth();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const [token, setToken] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isFullySignedIn, setIsFullySignedIn] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'Manager' | 'Team Member' | null>(null);

  useEffect(() => {
    // Clear any legacy persisted bearer tokens. Auth state remains Clerk-managed.
    localStorage.removeItem('session');
    localStorage.removeItem('authToken');
  }, []);

  useEffect(() => {
    offlineSyncService.setAuthTokenProvider(() => token);

    return () => {
      offlineSyncService.setAuthTokenProvider(() => null);
    };
  }, [token]);

  // Handle Clerk authentication state changes
  useEffect(() => {
    let isMounted = true;

    if (isLoaded && isSignedIn && user) {
      // Get the session token from Clerk
      getToken()
        .then((clerkToken) => {
          if (!isMounted) return;

          if (clerkToken) {
            setToken(clerkToken);
            setIsLoggedIn(true);
            setIsFullySignedIn(true);
            setUserId(decodeTokenAndGetUserId(clerkToken));
            setUserName(
              decodeTokenAndGetUserName(clerkToken) ||
                user.fullName ||
                user.primaryEmailAddress?.emailAddress ||
                null,
            );
            setUserRole(decodeTokenAndGetRole(clerkToken));
          }
        })
        .catch((error) => {
          if (!isMounted) return;
          Sentry.captureException(error, { tags: { feature: 'auth', action: 'getToken' } });
        });
    } else if (isLoaded && !isSignedIn) {
      // User signed out
      setToken(null);
      setIsLoggedIn(false);
      setIsFullySignedIn(false);
      setUserId(null);
      setUserName(null);
      setUserRole(null);
      localStorage.removeItem('session');
      localStorage.removeItem('authToken');
    }

    return () => {
      isMounted = false;
    };
  }, [isSignedIn, isLoaded, user, getToken]);

  const handleLogin = (newToken: string) => {
    setToken(newToken);
    setIsLoggedIn(true);
    setIsFullySignedIn(true);
    setUserId(decodeTokenAndGetUserId(newToken));
    setUserName(decodeTokenAndGetUserName(newToken));
    setUserRole(decodeTokenAndGetRole(newToken));
  };

  const clearClientAuthState = () => {
    setToken(null);
    setIsLoggedIn(false);
    setIsFullySignedIn(false);
    setUserId(null);
    setUserName(null);
    setUserRole(null);
    localStorage.removeItem('session');
    localStorage.removeItem('authToken');
  };

  const handleLogout = async () => {
    try {
      await signOut({ redirectUrl: '/login' });
    } catch (error) {
      Sentry.captureException(error, { tags: { feature: 'auth', action: 'logout' } });
    } finally {
      clearClientAuthState();
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
  };

  const hasOrganization = isOrgLoaded && !!organization;

  const contextValue: AuthContextType = {
    isLoggedIn,
    isFullySignedIn,
    hasOrganization,
    token,
    userId,
    userName,
    userRole,
    handleLogin,
    handleLogout,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

// Main provider component
export function ClerkAuthProvider({ children, publishableKey }: ClerkAuthProviderProps) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/login"
      signInUrl="/login"
      signUpUrl="/sign-up"
    >
      <ClerkAuthInner>{children}</ClerkAuthInner>
    </ClerkProvider>
  );
}
