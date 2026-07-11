import React, { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import * as Sentry from '@sentry/react';
import {
  ClerkSignInPage,
  ClerkSignUpPage,
  responsiveClerkAppearance,
} from './components/ClerkAuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthContext } from './components/ClerkAuthProvider';
import { ScanPage } from './pages/ScanPage';
import { UserProfile } from '@clerk/clerk-react';
import { StorageQuotaWarning } from './components/StorageQuotaWarning';
import { TrialBanner } from './components/TrialBanner';
import { TrialUpgradeFlow } from './components/TrialUpgradeFlow';
import SentryTest from './SentryTest';
import ErrorBoundary from './components/ErrorBoundary';
import { synchronizeOfflineData } from './lib/sync-manager';
import { offlineStorage as _offlineStorage } from './lib/offline-storage';
import { ToastProvider } from './components/ui/toast-provider';
import { HandheldProvider, useHandheldDetectionContext } from './contexts/HandheldContext';
import { useOrgBootstrap } from './hooks/useOrgBootstrap';
import { useFreshApiToken } from './hooks/useFreshApiToken';
import { hasPermission, PERMISSIONS, RoleValue } from './constants/roles';
import { HandheldLayout } from './layouts/HandheldLayout';
import { API_AUTH_UNAUTHORIZED_EVENT, API_BASE_URL } from './lib/api.service';
import { AppNav } from './components/AppNav';
import { useSyncStatus } from './hooks/useSyncStatus';
import './globals.css';
import './styles/handheld.css';
import './theme/scanner-adaptation.css';
import './theme/print-reports.css';

const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const ReportsPage = React.lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const UsageReportPage = React.lazy(() =>
  import('./pages/UsageReportPage').then((module) => ({ default: module.UsageReportPage })),
);
const MarkdownCalculator = React.lazy(() =>
  import('./components/MarkdownCalculator').then((module) => ({
    default: module.MarkdownCalculator,
  })),
);
const UserManagementPage = React.lazy(() =>
  import('./pages/UserManagementPage').then((module) => ({ default: module.UserManagementPage })),
);
const StoreAreaManagementPage = React.lazy(() =>
  import('./pages/StoreAreaManagementPage').then((module) => ({
    default: module.StoreAreaManagementPage,
  })),
);
const CSVUploadPage = React.lazy(() =>
  import('./pages/CSVUploadPage').then((module) => ({ default: module.CSVUploadPage })),
);
const DetailedExpiryReportPage = React.lazy(() =>
  import('./pages/DetailedExpiryReportPage').then((module) => ({
    default: module.DetailedExpiryReportPage,
  })),
);
const ExpiryEntriesPage = React.lazy(() =>
  import('./pages/ExpiryEntriesPage').then((module) => ({
    default: module.ExpiryEntriesPage,
  })),
);
const ExpiredItemsPage = React.lazy(() => import('./pages/ExpiredItemsPage'));
const SupplierCreditsPage = React.lazy(() => import('./pages/SupplierCreditsPage'));
const SubscriptionSettingsPage = React.lazy(() =>
  import('./pages/SubscriptionSettingsPage').then((module) => ({
    default: module.SubscriptionSettingsPage,
  })),
);

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
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
        >
          <div className="h-6 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        </div>
        <p className="font-medium text-foreground">{message}</p>
        <p className="text-sm text-muted-foreground mt-1">Preparing dates and stock records</p>
      </div>
    </div>
  );
}

function BootstrapErrorState({ error }: { error: string }) {
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
              {error}
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

function RouteLoadingState() {
  return (
    <div role="status" className="py-8 text-center text-sm font-medium text-muted-foreground">
      Preparing workspace
    </div>
  );
}

function runHandledHandheldSync(
  getSyncToken: () => Promise<string | undefined>,
  refreshPendingQueueCount: () => Promise<void>,
): void {
  void (async () => {
    await synchronizeOfflineData(getSyncToken);
    await refreshPendingQueueCount();
  })().catch((error: unknown) => {
    Sentry.captureException(error, {
      tags: { feature: 'handheld-sync' },
    });
  });
}

function useHandheldSyncNow(
  token: string | null,
  refreshPendingQueueCount: () => Promise<void>,
): () => void {
  const getFreshApiToken = useFreshApiToken(token);

  return useCallback(() => {
    runHandledHandheldSync(() => getFreshApiToken('app-handheld-sync'), refreshPendingQueueCount);
  }, [getFreshApiToken, refreshPendingQueueCount]);
}

function ProfilePage() {
  return (
    <div
      data-testid="profile-shell"
      className="mx-auto w-full max-w-5xl overflow-x-hidden rounded-lg border border-hairline bg-semantic-surface-1 px-3 py-4 sm:px-4 sm:py-6"
    >
      <div className="clerk-responsive-surface flex w-full justify-center">
        <UserProfile routing="path" path="/profile" appearance={responsiveClerkAppearance} />
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
    <React.Suspense fallback={<RouteLoadingState />}>
      <Routes>
        <Route
          path="/login/*"
          element={isLoggedIn ? <Navigate to="/scan" /> : <ClerkSignInPage />}
        />
        <Route
          path="/sign-up/*"
          element={isLoggedIn ? <Navigate to="/scan" /> : <ClerkSignUpPage />}
        />
        <Route path="/onboarding" element={renderSignedInElement(isLoggedIn, <OnboardingPage />)} />
        <Route
          path="/onboarding/*"
          element={renderSignedInElement(isLoggedIn, <OnboardingPage />)}
        />
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
        <Route
          path="/scan"
          element={renderSignedInElement(isLoggedIn, <ScanPage token={token} />)}
        />
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
          path="/expiry-entries"
          element={renderSignedInElement(
            isLoggedIn,
            <ExpiryEntriesPage token={token} role={effectiveUserRole} />,
          )}
        />
        <Route
          path="/expired-items"
          element={renderSignedInElement(isLoggedIn, <ExpiredItemsPage token={token} />)}
        />
        <Route
          path="/supplier-credits"
          element={renderSignedInElement(isLoggedIn, <SupplierCreditsPage token={token} />)}
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
    </React.Suspense>
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
  const { isHandheld, detectionResult } = useHandheldDetectionContext();
  const usesHandheldShell = isHandheld && detectionResult?.method !== 'dimensions';
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isOnline, pendingQueueCount, refreshPendingQueueCount } = useSyncStatus(isLoggedIn);
  const handleSyncNow = useHandheldSyncNow(token, refreshPendingQueueCount);

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

  // Redirect dedicated scanner devices to /scan by default (only when logged in).
  useEffect(() => {
    const shouldRedirectHandheldToScan =
      usesHandheldShell && isLoggedIn && pathname !== '/scan' && !pathname.startsWith('/login');
    if (shouldRedirectHandheldToScan) {
      navigate('/scan', { replace: true });
    }
  }, [usesHandheldShell, isLoggedIn, pathname, navigate]);

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
  const hasBootstrapFailed = !isBootstrapped && !isBootstrapping && isLoggedIn && !!bootstrapError;
  if (hasBootstrapFailed) {
    return <BootstrapErrorState error={bootstrapError!} />;
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
      {isLoggedIn && !usesHandheldShell && (
        <AppNav
          effectiveUserRole={effectiveUserRole}
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          handleLogout={handleLogout}
          pathname={pathname}
        />
      )}

      {usesHandheldShell ? (
        <HandheldLayout
          userName={userName || undefined}
          syncStatus={isOnline ? 'synced' : 'offline'}
          onSyncNow={handleSyncNow}
          onSettingsClick={() => {
            navigate('/settings');
          }}
          queueLength={pendingQueueCount}
        >
          <div className="h-full min-h-0" data-testid="handheld-route-shell">
            <ErrorBoundary>
              <AppRoutes
                isLoggedIn={isLoggedIn}
                effectiveUserRole={effectiveUserRole}
                token={token}
              />
            </ErrorBoundary>
          </div>
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
