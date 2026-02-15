import React, { useState, useEffect, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
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
import { StorageQuotaWarning } from './components/StorageQuotaWarning';
import SentryTest from './SentryTest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import ErrorBoundary from './components/ErrorBoundary';
import { synchronizeOfflineData } from './lib/sync-manager';
import { offlineSyncService } from './lib/offline-sync';
import { offlineStorage } from './lib/offline-storage';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { ToastProvider } from './components/ui/toast-provider';
import { HandheldProvider, useHandheldDetectionContext } from './contexts/HandheldContext';
import { HandheldLayout } from './layouts/HandheldLayout';
import './globals.css';
import './styles/handheld.css';

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

// Helper function to verify if a token is still valid by checking its expiration
const verifyToken = (token: string | null): boolean => {
  if (!token) return false;
  try {
    const decodedToken = jwtDecode<JwtPayload>(token);
    const currentTime = Date.now() / 1000; // Convert to Unix timestamp
    // If the token is expired, return false
    return decodedToken.exp ? decodedToken.exp > currentTime : false;
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return false; // If there's an error decoding, treat it as invalid
  }
};

// Helper function to decode JWT and get role
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
    Sentry.captureMessage('Unknown role in session, defaulting to Team Member', {
      level: 'warning',
      tags: { feature: 'auth' },
    });
    return 'Team Member'; // Default role if not specified
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'auth' } });
    return 'Team Member'; // Default to Team Member on error
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

// Helper function to decode JWT and get user name
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

// Component that uses handheld context for conditional rendering
function AppContent({
  isLoggedIn,
  userId,
  userName,
  userRole,
  token,
  handleLogout,
  handleLogin,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
}: {
  isLoggedIn: boolean;
  userId: number | null;
  userName: string | null;
  userRole: 'Manager' | 'Team Member' | null;
  token: string | null;
  handleLogout: () => void;
  handleLogin: (newToken: string) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}) {
  const PENDING_INVENTORY_ITEMS_PREFIX = 'pending-inventory-item-';
  const { isHandheld } = useHandheldDetectionContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const refreshPendingQueueCount = useCallback(async () => {
    try {
      const keys = await offlineStorage.keys();
      const pendingInventoryCount = keys.filter((key) =>
        key.startsWith(PENDING_INVENTORY_ITEMS_PREFIX),
      ).length;
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isLoggedIn && userId && <StorageQuotaWarning userId={userId} subscriptionTier="free" />}
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
                    <Link to="/sentry-test" className="hover:opacity-90 transition-opacity">
                      Sentry Test
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
                      <DropdownMenuContent className="bg-white text-gray-800 border border-gray-200 rounded-md shadow-lg p-1 mt-1">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/reports"
                            className="block px-4 py-2 hover:bg-gray-100 rounded-sm transition-colors"
                          >
                            Overview Reports
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/detailed-expiry-report"
                            className="block px-4 py-2 hover:bg-gray-100 rounded-sm transition-colors"
                          >
                            Detailed Expiry Report
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/expired-items"
                            className="block px-4 py-2 hover:bg-gray-100 rounded-sm transition-colors"
                          >
                            Expired Items
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/usage-report"
                            className="block px-4 py-2 hover:bg-gray-100 rounded-sm transition-colors"
                          >
                            Usage Report
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
                  {userRole === 'Manager' && (
                    <>
                      <li>
                        <Link to="/user-management" className="hover:opacity-90 transition-opacity">
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
                      to="/sentry-test"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Sentry Test
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
                  <li className="border-t border-gray-600 pt-2 mt-2">
                    <Link
                      to="/markdown-calculator"
                      className="block hover:opacity-90 transition-opacity"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Markdown Calculator
                    </Link>
                  </li>
                  {userRole === 'Manager' && (
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
              <Routes>
                <Route
                  path="/login"
                  element={
                    isLoggedIn ? <Navigate to="/scan" /> : <LoginPage onLogin={handleLogin} />
                  }
                />
                <Route
                  path="/scan"
                  element={isLoggedIn ? <ScanPage token={token} /> : <Navigate to="/login" />}
                />
                <Route
                  path="/sentry-test"
                  element={isLoggedIn ? <SentryTest /> : <Navigate to="/login" />}
                />
                <Route
                  path="/dashboard"
                  element={isLoggedIn ? <DashboardPage token={token} /> : <Navigate to="/login" />}
                />
                <Route
                  path="/reports"
                  element={isLoggedIn ? <ReportsPage token={token} /> : <Navigate to="/login" />}
                />
                <Route
                  path="/detailed-expiry-report"
                  element={
                    isLoggedIn ? (
                      <DetailedExpiryReportPage token={token} />
                    ) : (
                      <Navigate to="/login" />
                    )
                  }
                />
                <Route
                  path="/expired-items"
                  element={
                    isLoggedIn ? <ExpiredItemsPage token={token} /> : <Navigate to="/login" />
                  }
                />
                <Route
                  path="/usage-report"
                  element={
                    isLoggedIn ? <UsageReportPage token={token} /> : <Navigate to="/login" />
                  }
                />
                <Route
                  path="/markdown-calculator"
                  element={
                    isLoggedIn ? <MarkdownCalculator token={token} /> : <Navigate to="/login" />
                  }
                />
                {userRole === 'Manager' && (
                  <>
                    <Route
                      path="/user-management"
                      element={
                        isLoggedIn ? <UserManagementPage token={token} /> : <Navigate to="/login" />
                      }
                    />
                    <Route
                      path="/store-area-management"
                      element={
                        isLoggedIn ? (
                          <StoreAreaManagementPage token={token} />
                        ) : (
                          <Navigate to="/login" />
                        )
                      }
                    />
                    <Route
                      path="/csv-upload"
                      element={
                        isLoggedIn ? <CSVUploadPage token={token} /> : <Navigate to="/login" />
                      }
                    />
                  </>
                )}
                <Route path="*" element={<Navigate to="/login" />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </HandheldLayout>
      ) : (
        <main className="p-4 max-w-7xl mx-auto">
          <ErrorBoundary>
            <Routes>
              <Route
                path="/login"
                element={isLoggedIn ? <Navigate to="/scan" /> : <LoginPage onLogin={handleLogin} />}
              />
              <Route
                path="/scan"
                element={isLoggedIn ? <ScanPage token={token} /> : <Navigate to="/login" />}
              />
              <Route
                path="/sentry-test"
                element={isLoggedIn ? <SentryTest /> : <Navigate to="/login" />}
              />
              <Route
                path="/dashboard"
                element={isLoggedIn ? <DashboardPage token={token} /> : <Navigate to="/login" />}
              />
              <Route
                path="/reports"
                element={isLoggedIn ? <ReportsPage token={token} /> : <Navigate to="/login" />}
              />
              <Route
                path="/detailed-expiry-report"
                element={
                  isLoggedIn ? <DetailedExpiryReportPage token={token} /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/expired-items"
                element={isLoggedIn ? <ExpiredItemsPage token={token} /> : <Navigate to="/login" />}
              />
              <Route
                path="/usage-report"
                element={isLoggedIn ? <UsageReportPage token={token} /> : <Navigate to="/login" />}
              />
              <Route
                path="/markdown-calculator"
                element={
                  isLoggedIn ? <MarkdownCalculator token={token} /> : <Navigate to="/login" />
                }
              />
              {userRole === 'Manager' && (
                <>
                  <Route
                    path="/user-management"
                    element={
                      isLoggedIn ? <UserManagementPage token={token} /> : <Navigate to="/login" />
                    }
                  />
                  <Route
                    path="/store-area-management"
                    element={
                      isLoggedIn ? (
                        <StoreAreaManagementPage token={token} />
                      ) : (
                        <Navigate to="/login" />
                      )
                    }
                  />
                  <Route
                    path="/csv-upload"
                    element={
                      isLoggedIn ? <CSVUploadPage token={token} /> : <Navigate to="/login" />
                    }
                  />
                </>
              )}
              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          </ErrorBoundary>
        </main>
      )}
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'Manager' | 'Team Member' | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Check for forceHandheld query parameter on mount
  useEffect(() => {
    checkForceHandheldQueryParam();
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('session');
    if (storedToken && verifyToken(storedToken)) {
      setToken(storedToken);
      setIsLoggedIn(true);
      setUserId(decodeTokenAndGetUserId(storedToken));
      setUserName(decodeTokenAndGetUserName(storedToken));
      setUserRole(decodeTokenAndGetRole(storedToken));
    }
  }, []);

  const handleLogin = (newToken: string) => {
    setToken(newToken);
    setIsLoggedIn(true);
    setUserId(decodeTokenAndGetUserId(newToken));
    setUserName(decodeTokenAndGetUserName(newToken));
    setUserRole(decodeTokenAndGetRole(newToken));
    localStorage.setItem('session', newToken);
  };

  const handleLogout = () => {
    setToken(null);
    setIsLoggedIn(false);
    setUserId(null);
    setUserName(null);
    setUserRole(null);
    localStorage.removeItem('session');
    // Clear any offline data on logout
    synchronizeOfflineData(null);
  };

  return (
    <ToastProvider>
      <HandheldProvider>
        <Router>
          <AppContent
            isLoggedIn={isLoggedIn}
            userId={userId}
            userName={userName}
            userRole={userRole}
            token={token}
            handleLogout={handleLogout}
            handleLogin={handleLogin}
            isMobileMenuOpen={isMobileMenuOpen}
            setIsMobileMenuOpen={setIsMobileMenuOpen}
          />
        </Router>
      </HandheldProvider>
    </ToastProvider>
  );
}

export default App;
