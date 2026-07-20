import React, { useState, useEffect } from 'react';
import { useUser, useAuth, useOrganization, ClerkProvider } from '@clerk/clerk-react';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import * as Sentry from '@sentry/react';
import { offlineSyncService } from '../lib/offline-sync';
import { RoleValue, normalizeRole } from '../constants/roles';

interface ClerkAuthProviderProps {
  children: React.ReactNode;
  publishableKey: string;
}

const decodeTokenAndGetRole = (token: string | null): RoleValue | null => {
  if (!token) return null;
  try {
    const decodedToken = jwtDecode<JwtPayload & { role?: string; org_role?: string }>(token);
    return normalizeRole(decodedToken.role ?? decodedToken.org_role);
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return 'team_member';
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

const decodeTokenAndGetUserEmail = (token: string | null): string | null => {
  if (!token) return null;
  try {
    const decodedToken = jwtDecode<JwtPayload & { email?: string }>(token);
    return typeof decodedToken.email === 'string' ? decodedToken.email : null;
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return null;
  }
};

// Auth context to share auth state
interface AuthContextType {
  isLoading: boolean;
  isLoggedIn: boolean;
  isFullySignedIn: boolean;
  hasOrganization: boolean;
  token: string | null;
  userId: number | null;
  userName: string | null;
  userRole: RoleValue | null;
  updateBootstrapRole: (role: RoleValue) => void;
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
  const [userRole, setUserRole] = useState<RoleValue | null>(null);

  useEffect(() => {
    // Clear any legacy persisted bearer tokens. Auth state remains Clerk-managed.
    localStorage.removeItem('session');
    localStorage.removeItem('authToken');
  }, []);

  useEffect(() => {
    offlineSyncService.setAuthTokenProvider(async () => (await getToken()) || token);

    return () => {
      offlineSyncService.setAuthTokenProvider(() => null);
    };
  }, [getToken, token]);

  // Handle Clerk authentication state changes
  useEffect(() => {
    let isMounted = true;

    if (isLoaded && isSignedIn && user) {
      // Get the session token from Clerk
      getToken()
        .then((clerkToken) => {
          if (!isMounted) return;

          if (clerkToken) {
            const resolvedUserId = decodeTokenAndGetUserId(clerkToken);
            const resolvedUserName =
              decodeTokenAndGetUserName(clerkToken) ||
              user.fullName ||
              user.primaryEmailAddress?.emailAddress ||
              null;
            const resolvedUserEmail =
              user.primaryEmailAddress?.emailAddress || decodeTokenAndGetUserEmail(clerkToken);

            setToken(clerkToken);
            setIsLoggedIn(true);
            setIsFullySignedIn(true);
            setUserId(resolvedUserId);
            setUserName(resolvedUserName);
            setUserRole(decodeTokenAndGetRole(clerkToken));

            Sentry.setUser({
              id: resolvedUserId ? String(resolvedUserId) : undefined,
              username: resolvedUserName || undefined,
              email: resolvedUserEmail || undefined,
            });
          }
        })
        .catch((error) => {
          if (!isMounted) return;
          Sentry.captureException(error, { tags: { feature: 'auth', action: 'getToken' } });
        });
    } else if (isLoaded && !isSignedIn) {
      // User signed out
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs local auth state to Clerk's external sign-in state
      setToken(null);
      setIsLoggedIn(false);
      setIsFullySignedIn(false);
      setUserId(null);
      setUserName(null);
      setUserRole(null);
      Sentry.setUser(null);
      localStorage.removeItem('session');
      localStorage.removeItem('authToken');
    }

    return () => {
      isMounted = false;
    };
  }, [isSignedIn, isLoaded, user, getToken]);

  const handleLogin = (newToken: string) => {
    const resolvedUserId = decodeTokenAndGetUserId(newToken);
    const resolvedUserName = decodeTokenAndGetUserName(newToken);

    setToken(newToken);
    setIsLoggedIn(true);
    setIsFullySignedIn(true);
    setUserId(resolvedUserId);
    setUserName(resolvedUserName);
    setUserRole(decodeTokenAndGetRole(newToken));

    Sentry.setUser({
      id: resolvedUserId ? String(resolvedUserId) : undefined,
      username: resolvedUserName || undefined,
      email: decodeTokenAndGetUserEmail(newToken) || undefined,
    });
  };

  const clearClientAuthState = () => {
    setToken(null);
    setIsLoggedIn(false);
    setIsFullySignedIn(false);
    setUserId(null);
    setUserName(null);
    setUserRole(null);
    Sentry.setUser(null);
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
  // Keep loading true while Clerk SDK initializes OR while a signed-in user
  // is waiting for the async getToken() call to resolve. This prevents a gap
  // where isLoggedIn is false but the user IS authenticated, which caused
  // flash-redirects to /login and double 2FA screen renders.
  const isLoading = !isLoaded || (isLoaded && !!isSignedIn && !token);

  const contextValue: AuthContextType = {
    isLoading,
    isLoggedIn,
    isFullySignedIn,
    hasOrganization,
    token,
    userId,
    userName,
    userRole,
    updateBootstrapRole: setUserRole,
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
