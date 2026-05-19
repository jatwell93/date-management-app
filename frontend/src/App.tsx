import React, { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { ClerkSignInPage, ClerkSignUpPage } from './components/ClerkAuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthContext } from './components/ClerkAuthProvider';
import { ScanPage } from './pages/ScanPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { UsageReportPage } from './pages/UsageReportPage';
import { MarkdownCalculator } from './components/MarkdownCalculator';
import { UserManagementPage } from './pages/UserManagementPage';
import { StoreAreaManagementPage } from './pages/StoreAreaManagementPage';
import { CSVUploadPage } from './pages/CSVUploadPage';
import { DetailedExpiryReportPage } from './pages/DetailedExpiryReportPage';
import ExpiredItemsPage from './pages/ExpiredItemsPage';
import { SubscriptionSettingsPage } from './pages/SubscriptionSettingsPage';
import { UserProfile } from '@clerk/clerk-react';
import { StorageQuotaWarning } from './components/StorageQuotaWarning';
import { TrialBanner } from './components/TrialBanner';
import { TrialUpgradeFlow } from './components/TrialUpgradeFlow';
import SentryTest from './SentryTest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import ErrorBoundary from './components/ErrorBoundary';
import { synchronizeOfflineData, getPendingInventoryItemCount } from './lib/sync-manager';
import { offlineSyncService } from './lib/offline-sync';
import { offlineStorage as _offlineStorage } from './lib/offline-storage';
import { ToastProvider } from './components/ui/toast-provider';
import { HandheldProvider, useHandheldDetectionContext } from './contexts/HandheldContext';
import { useOrgBootstrap } from './hooks/useOrgBootstrap';
import { hasPermission, PERMISSIONS, RoleValue } from './constants/roles';
import { HandheldLayout } from './layouts/HandheldLayout';
import { API_AUTH_UNAUTHORIZED_EVENT, API_BASE_URL } from './lib/api.service';
import './globals.css';
import './styles/handheld.css';
import './theme/scanner-adaptation.css';

// Helper function to check for forceHandheld query parameter
const checkForceHandheldQueryParam = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const forceHandheld = urlParams.get('forceHandheld');
  if (forceHandheld === 'true') {
    localStorage.setItem('forceHandheld', 'true');
    // Clean up the URL by removing the query param
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    return true;
  }
  return false;
};

// Legacy JWT helpers removed - use ClerkAuthProvider context instead

function ExpiryLoadingState({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
        >
          <div className="h-6 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        </div>
        <p className="font-medium text-foreground">{message}</p>
        <p className="text-sm text-muted-foreground mt-1">Preparing dates and stock records</p>
      </div>
    </div>
  );
}

function ProfilePage() {
  return (
    <div data-testid="profile-shell" className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex justify-center">
        <UserProfile routing="path" path="/profile" />
      </div>
    </div>
  );
}

function isExpectQaStatusEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.REACT_APP_EXPECT_QA_STATUS === 'true';
}

function useExpectQaPanelState() {
  const [isCompactViewport, setIsCompactViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );
  const [isExpanded, setIsExpanded] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true,
  );

  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth < 640;
      setIsCompactViewport(compact);
      setIsExpanded(!compact);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { isCompactViewport, isExpanded, setIsExpanded };
}

function ExpectQaToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open QA diagnostics"
      onClick={onOpen}
      className="fixed bottom-3 left-3 z-50 rounded-full border border-semantic-warning-muted bg-semantic-warning-muted px-3 py-2 text-xs font-semibold text-semantic-warning-muted-foreground shadow-lg"
    >
      QA
    </button>
  );
}

interface ExpectQaStatusProps {
  isLoggedIn: boolean;
  isFullySignedIn: boolean;
  hasOrganization: boolean;
  userId: number | null;
  userName: string | null;
  frontendRole: string | null;
  backendRole: string | null;
  organizationId: string | null;
  bootstrapStatus: 'ready' | 'loading' | 'error' | 'pending';
  bootstrapError: string | null;
  hasToken: boolean;
}

function ExpectQaStatus({
  isLoggedIn,
  isFullySignedIn,
  hasOrganization,
  userId,
  userName,
  frontendRole,
  backendRole,
  organizationId,
  bootstrapStatus,
  bootstrapError,
  hasToken,
}: ExpectQaStatusProps) {
  const { isCompactViewport, isExpanded, setIsExpanded } = useExpectQaPanelState();

  if (!isExpectQaStatusEnabled()) {
    return null;
  }

  if (isCompactViewport && !isExpanded) {
    return <ExpectQaToggle onOpen={() => setIsExpanded(true)} />;
  }

  return (
    <section
      aria-label="Expect QA auth diagnostics"
      data-testid="expect-qa-status"
      className="fixed bottom-3 right-3 z-50 max-w-sm rounded-md border border-semantic-warning-muted bg-semantic-warning-muted p-3 text-xs text-semantic-warning-muted-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">Expect QA</div>
        {isCompactViewport && (
          <button
            type="button"
            aria-label="Close QA diagnostics"
            onClick={() => setIsExpanded(false)}
            className="rounded border border-semantic-warning-muted px-2 py-1 font-semibold"
          >
            Close
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <dt>logged-in:</dt>
        <dd data-testid="expect-qa-logged-in">{isLoggedIn ? 'yes' : 'no'}</dd>
        <dt>fully-signed-in:</dt>
        <dd data-testid="expect-qa-fully-signed-in">{isFullySignedIn ? 'yes' : 'no'}</dd>
        <dt>has-organization:</dt>
        <dd data-testid="expect-qa-has-organization">{hasOrganization ? 'yes' : 'no'}</dd>
        <dt>user-id:</dt>
        <dd data-testid="expect-qa-user-id">{userId ?? 'none'}</dd>
        <dt>user-name:</dt>
        <dd data-testid="expect-qa-user-name">{userName ?? 'none'}</dd>
        <dt>frontend-role:</dt>
        <dd data-testid="expect-qa-frontend-role">{frontendRole ?? 'none'}</dd>
        <dt>backend-role:</dt>
        <dd data-testid="expect-qa-backend-role">{backendRole ?? 'none'}</dd>
        <dt>organization-id:</dt>
        <dd data-testid="expect-qa-organization-id">{organizationId ?? 'none'}</dd>
        <dt>bootstrap:</dt>
        <dd data-testid="expect-qa-bootstrap-status">{bootstrapStatus}</dd>
        <dt>bootstrap-error:</dt>
        <dd data-testid="expect-qa-bootstrap-error">{bootstrapError ?? 'none'}</dd>
        <dt>token:</dt>
        <dd data-testid="expect-qa-token">{hasToken ? 'present' : 'missing'}</dd>
        <dt>api-base-url:</dt>
        <dd data-testid="expect-qa-api-base-url">{API_BASE_URL}</dd>
      </dl>
    </section>
  );
}

interface AppRoutesProps {
  isLoggedIn: boolean;
  effectiveUserRole: RoleValue | null;
  token: string | null;
}

function renderSignedInElement(isLoggedIn: boolean, element: React.ReactNode) {
  return isLoggedIn ? element : <Navigate to="/login" />;
}

function renderAdminElement(
  isLoggedIn: boolean,
  effectiveUserRole: RoleValue | null,
  element: React.ReactNode,
) {
  if (!isLoggedIn) {
    return <Navigate to="/login" />;
  }

  if (!effectiveUserRole || !hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS)) {
    return <Navigate to="/scan" />;
  }

  return element;
}

function AppRoutes({ isLoggedIn, effectiveUserRole, token }: AppRoutesProps) {
  const hasAdminPermissions =
    !!effectiveUserRole && hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS);

  return (
    <Routes>
      <Route path="/login/*" element={isLoggedIn ? <Navigate to="/scan" /> : <ClerkSignInPage />} />
      <Route
        path="/sign-up/*"
        element={isLoggedIn ? <Navigate to="/scan" /> : <ClerkSignUpPage />}
      />
      <Route path="/onboarding" element={renderSignedInElement(isLoggedIn, <OnboardingPage />)} />
      <Route path="/onboarding/*" element={renderSignedInElement(isLoggedIn, <OnboardingPage />)} />
      <Route
        path="/settings"
        element={renderAdminElement(isLoggedIn, effectiveUserRole, <SettingsPage />)}
      />
      <Route
        path="/settings/*"
        element={renderAdminElement(isLoggedIn, effectiveUserRole, <SettingsPage />)}
      />
      <Route
        path="/upgrade"
        element={renderSignedInElement(isLoggedIn, <TrialUpgradeFlow token={token} />)}
      />
      <Route path="/scan" element={renderSignedInElement(isLoggedIn, <ScanPage token={token} />)} />
      <Route path="/sentry-test" element={renderSignedInElement(isLoggedIn, <SentryTest />)} />
      <Route
        path="/dashboard"
        element={renderSignedInElement(isLoggedIn, <DashboardPage token={token} />)}
      />
      <Route
        path="/reports"
        element={renderSignedInElement(isLoggedIn, <ReportsPage token={token} />)}
      />
      <Route
        path="/detailed-expiry-report"
        element={renderSignedInElement(isLoggedIn, <DetailedExpiryReportPage token={token} />)}
      />
      <Route
        path="/expired-items"
        element={renderSignedInElement(isLoggedIn, <ExpiredItemsPage token={token} />)}
      />
      <Route
        path="/usage-report"
        element={renderSignedInElement(isLoggedIn, <UsageReportPage token={token} />)}
      />
      <Route
        path="/markdown-calculator"
        element={renderSignedInElement(isLoggedIn, <MarkdownCalculator token={token} />)}
      />
      <Route path="/profile" element={renderSignedInElement(isLoggedIn, <ProfilePage />)} />
      <Route path="/profile/*" element={renderSignedInElement(isLoggedIn, <ProfilePage />)} />
      <Route
        path="/subscription"
        element={renderSignedInElement(isLoggedIn, <SubscriptionSettingsPage token={token} />)}
      />
      {hasAdminPermissions && (
        <>
          <Route
            path="/user-management"
            element={renderSignedInElement(isLoggedIn, <UserManagementPage />)}
          />
          <Route
            path="/store-area-management"
            element={renderSignedInElement(isLoggedIn, <StoreAreaManagementPage token={token} />)}
          />
          <Route
            path="/csv-upload"
            element={renderSignedInElement(isLoggedIn, <CSVUploadPage token={token} />)}
          />
          <Route
            path="/expiry-import"
            element={renderSignedInElement(
              isLoggedIn,
              <CSVUploadPage token={token} defaultImportType="expiry-list" />,
            )}
          />
        </>
      )}
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}

// Component that uses handheld context for conditional rendering
function AppContent({
  isMobileMenuOpen,
  setIsMobileMenuOpen,
}: {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}) {
  const {
    isLoading: isAuthLoading,
    isLoggedIn: hasSession,
    isFullySignedIn,
    hasOrganization,
    userId,
    userName,
    userRole,
    updateBootstrapRole,
    token,
    handleLogout,
  } = useAuthContext();
  const isLoggedIn = hasSession && isFullySignedIn;
  const { isBootstrapped, isBootstrapping, bootstrapError, bootstrapResult } = useOrgBootstrap();

  // Task 1.1: Debug role propagation timing
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (isBootstrapping) {
      timeoutId = setTimeout(() => {
        if (isBootstrapping) {
          Sentry.captureMessage(
            '[Bootstrap] Organization bootstrap is taking longer than 2 seconds...',
            'warning',
          );
        }
      }, 2000);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isBootstrapping]);

  const hasCurrentUserBootstrapRole = isBootstrapped && !!bootstrapResult?.role;
  const effectiveUserRole = hasCurrentUserBootstrapRole ? bootstrapResult.role : userRole;
  const bootstrapStatus = isBootstrapping
    ? 'loading'
    : bootstrapError
      ? 'error'
      : isBootstrapped
        ? 'ready'
        : 'pending';

  useEffect(() => {
    if (hasCurrentUserBootstrapRole) {
      updateBootstrapRole(bootstrapResult.role);
    }
  }, [bootstrapResult?.role, hasCurrentUserBootstrapRole, updateBootstrapRole]);
  const { isHandheld } = useHandheldDetectionContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const refreshPendingQueueCount = useCallback(async () => {
    try {
      const pendingInventoryCount = await getPendingInventoryItemCount(); // ✓ Use centralized function (fixes 17.3)
      const operationQueueCount = offlineSyncService.getPendingOperationCount();
      setPendingQueueCount(pendingInventoryCount + operationQueueCount);
    } catch (_error) {
      setPendingQueueCount(offlineSyncService.getPendingOperationCount());
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Handle API authorization failures (401 responses)
  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      // Log the unauthorized event for debugging
      if (event instanceof CustomEvent) {
        // eslint-disable-next-line no-console
        console.warn('[Auth] Unauthorized API response detected:', event.detail);
      }
      // Call logout to clear auth state and redirect to login
      handleLogout();
    };

    window.addEventListener(API_AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);

    return () => {
      window.removeEventListener(API_AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, [handleLogout]);

  useEffect(() => {
    void refreshPendingQueueCount();
    const intervalId = window.setInterval(() => {
      void refreshPendingQueueCount();
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, refreshPendingQueueCount]);

  // Redirect handheld devices to /scan by default (only when logged in)
  useEffect(() => {
    if (
      isHandheld &&
      isLoggedIn &&
      location.pathname !== '/scan' &&
      !location.pathname.startsWith('/login')
    ) {
      // Use React Router navigation instead of full page reload
      navigate('/scan', { replace: true });
    }
  }, [isHandheld, isLoggedIn, location.pathname, navigate]);

  // Show loading state while Clerk auth is still initializing so protected
  // routes don't flash-redirect to /login on page refresh.
  if (isAuthLoading) {
    return <ExpiryLoadingState message="Checking expiry workspace" />;
  }

  // Show loading state while bootstrap is in progress.
  if (isBootstrapping) {
    return <ExpiryLoadingState message="Checking expiry workspace" />;
  }

  // Show error state if bootstrap failed.
  if (!isBootstrapped && !isBootstrapping && isLoggedIn && bootstrapError) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-semibold text-destructive mb-2">Setup Required</h1>
          <p className="text-muted-foreground mb-4">
            Please complete your organization setup to continue.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <details className="mb-4 text-left bg-destructive/10 p-3 rounded text-sm">
              <summary className="cursor-pointer font-semibold mb-2">Debug Info</summary>
              <code className="block whitespace-pre-wrap break-words text-xs text-destructive">
                {bootstrapError}
              </code>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Retry Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isLoggedIn && userId && (
        <StorageQuotaWarning userId={userId} token={token} subscriptionTier="free" />
      )}
      {isLoggedIn && token && <TrialBanner token={token} />}
      <ExpectQaStatus
        isLoggedIn={isLoggedIn}
        isFullySignedIn={isFullySignedIn}
        hasOrganization={hasOrganization}
        userId={userId}
        userName={userName}
        frontendRole={userRole}
        backendRole={bootstrapResult?.role ?? null}
        organizationId={bootstrapResult?.organizationId ?? null}
        bootstrapStatus={bootstrapStatus}
        bootstrapError={bootstrapError}
        hasToken={!!token}
      />
      {isLoggedIn && !isHandheld && (
        <nav className="bg-primary text-primary-foreground p-4 shadow-md">
          <div className="container mx-auto">
            {/* Top-level container for the navigation elements */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Link to="/scan" className="font-semibold hover:opacity-90 transition-opacity">
                  <h1 className="text-xl">Inventory Manager</h1>
                </Link>

                {/* Mobile menu button */}
                <button
                  className="md:hidden text-primary-foreground focus:outline-none p-2 hover:bg-primary-foreground/10 rounded-md transition-colors"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  aria-label="Toggle mobile menu"
                >
                  {isMobileMenuOpen ? (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M6 18L18 6M6 6l12 12"
                      ></path>
                    </svg>
                  ) : (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      ></path>
                    </svg>
                  )}
                </button>
              </div>

              <div className="flex items-center space-x-2">
                {/* Desktop Navigation - moved inside the right-aligned div */}
                <ul className="hidden md:flex space-x-6">
                  <li>
                    <Link to="/scan" className="hover:opacity-90 transition-opacity">
                      Scan
                    </Link>
                  </li>
                  <li>
                    <Link to="/dashboard" className="hover:opacity-90 transition-opacity">
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="hover:opacity-90 transition-opacity focus:outline-none bg-transparent border-none cursor-pointer">
                        Reports
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-1 mt-1">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/reports"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Overview Reports
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/detailed-expiry-report"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Detailed Expiry Report
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/expired-items"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Expired Items
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/usage-report"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Usage Report
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                  <li>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="hover:opacity-90 transition-opacity focus:outline-none bg-transparent border-none cursor-pointer">
                        Account
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-1 mt-1">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/profile"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Profile
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/subscription"
                            className="block px-4 py-2 hover:bg-accent rounded-sm transition-colors"
                          >
                            Billing
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                  <li>
                    <Link to="/markdown-calculator" className="hover:opacity-90 transition-opacity">
                      Markdown Calculator
                    </Link>
                  </li>
                  {effectiveUserRole &&
                    hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS) && (
                      <>
                        <li>
                          <Link
                            to="/user-management"
                            className="hover:opacity-90 transition-opacity"
                          >
                            User Management
                          </Link>
                        </li>
                        <li>
                          <Link
                            to="/store-area-management"
                            className="hover:opacity-90 transition-opacity"
                          >
                            Store Areas
                          </Link>
                        </li>
                        <li>
                          <Link to="/csv-upload" className="hover:opacity-90 transition-opacity">
                            CSV Upload
                          </Link>
                        </li>
                        <li>
                          <Link to="/expiry-import" className="hover:opacity-90 transition-opacity">
                            Expiry Import
                          </Link>
                        </li>
                        <li>
                          <Link to="/settings" className="hover:opacity-90 transition-opacity">
                            Settings
                          </Link>
                        </li>
                      </>
                    )}
                </ul>

                {/* Desktop Logout button */}
                <div className="hidden md:block">
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Navigation Menu - only visible when the hamburger is clicked */}
            {isMobileMenuOpen && (
              <div className="md:hidden mt-4 py-4 bg-primary text-primary-foreground rounded-md shadow-lg">
                <ul className="space-y-4">
                  <li>
                    <Link
                      to="/scan"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Scan
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/dashboard"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/reports"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Overview Reports
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/detailed-expiry-report"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Detailed Expiry Report
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/expired-items"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Expired Items
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/usage-report"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Usage Report
                    </Link>
                  </li>
                  <li className="border-t border-border pt-2 mt-2">
                    <Link
                      to="/markdown-calculator"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Markdown Calculator
                    </Link>
                  </li>
                  <li className="border-t border-border pt-2 mt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-75">
                      Account
                    </div>
                  </li>
                  <li>
                    <Link
                      to="/profile"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Profile
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/subscription"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Billing
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/upgrade"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Upgrade
                    </Link>
                  </li>
                  {effectiveUserRole &&
                    hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS) && (
                      <>
                        <li>
                          <Link
                            to="/user-management"
                            className="block hover:opacity-90 transition-opacity"
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            User Management
                          </Link>
                        </li>
                        <li>
                          <Link
                            to="/store-area-management"
                            className="block hover:opacity-90 transition-opacity"
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            Store Areas
                          </Link>
                        </li>
                        <li>
                          <Link
                            to="/csv-upload"
                            className="block hover:opacity-90 transition-opacity"
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            CSV Upload
                          </Link>
                        </li>
                        <li>
                          <Link
                            to="/expiry-import"
                            className="block hover:opacity-90 transition-opacity"
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            Expiry Import
                          </Link>
                        </li>
                        <li>
                          <Link
                            to="/settings"
                            className="block hover:opacity-90 transition-opacity"
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            Settings
                          </Link>
                        </li>
                      </>
                    )}
                  <li>
                    <button
                      onClick={() => {
                        handleLogout();
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
                    >
                      Logout
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </nav>
      )}

      {isHandheld ? (
        <HandheldLayout
          userName={userName || undefined}
          syncStatus={isOnline ? 'synced' : 'offline'}
          onSyncNow={async () => {
            await synchronizeOfflineData(token);
            await refreshPendingQueueCount();
          }}
          onSettingsClick={() => {
            // TODO: Implement settings navigation
          }}
          queueLength={pendingQueueCount}
        >
          <main className="p-4 max-w-7xl mx-auto">
            <ErrorBoundary>
              <AppRoutes
                isLoggedIn={isLoggedIn}
                effectiveUserRole={effectiveUserRole}
                token={token}
              />
            </ErrorBoundary>
          </main>
        </HandheldLayout>
      ) : (
        <main className="p-4 max-w-7xl mx-auto">
          <ErrorBoundary>
            <AppRoutes
              isLoggedIn={isLoggedIn}
              effectiveUserRole={effectiveUserRole}
              token={token}
            />
          </ErrorBoundary>
        </main>
      )}
    </div>
  );
}

function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Check for forceHandheld query parameter on mount
  useEffect(() => {
    checkForceHandheldQueryParam();
  }, []);

  return (
    <ToastProvider>
      <HandheldProvider>
        <Router>
          <AppContent
            isMobileMenuOpen={isMobileMenuOpen}
            setIsMobileMenuOpen={setIsMobileMenuOpen}
          />
        </Router>
      </HandheldProvider>
    </ToastProvider>
  );
}

export default App;
