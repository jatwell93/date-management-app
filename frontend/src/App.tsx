import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import ErrorBoundary from './components/ErrorBoundary';
import { synchronizeOfflineData } from './lib/sync-manager';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { ToastProvider } from './components/ui/toast-provider';
import './globals.css';

// Helper function to verify if a token is still valid by checking its expiration
const verifyToken = (token: string | null): boolean => {
  if (!token) return false;
  try {
    const decodedToken = jwtDecode<JwtPayload>(token);
    const currentTime = Date.now() / 1000; // Convert to Unix timestamp
    // If the token is expired, return false
    return decodedToken.exp > currentTime;
  } catch (error) {
    console.error('Error decoding session:', error);
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
    console.warn('Unknown role in session, defaulting to Team Member');
    return 'Team Member'; // Default role if not specified
  } catch (error) {
    console.error('Error decoding session:', error);
    return 'Team Member'; // Default to Team Member on error
  }
};

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      // Verify that the token is still valid by checking if it's expired
      return verifyToken(token);
    }
    return false;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('authToken');
  });
  const [userRole, setUserRole] = useState<'Manager' | 'Team Member' | null>(() => {
    return decodeTokenAndGetRole(localStorage.getItem('authToken'));
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogin = (newToken: string) => {
    localStorage.setItem('authToken', newToken);
    setIsLoggedIn(true);
    setToken(newToken);
    setUserRole(decodeTokenAndGetRole(newToken));
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setIsLoggedIn(false);
    setToken(null);
    setUserRole(null);
  };

  useEffect(() => {
    // Re-evaluate role if token changes (e.g., on initial load or if token is manually set)
    setUserRole(decodeTokenAndGetRole(token));
  }, [token]);

  useEffect(() => {
    const handleOnline = () => {
      // console.log("App is online. Attempting to synchronize offline data.");
      if (token) {
        synchronizeOfflineData(token);
      }
    };

    // Initial synchronization attempt if online
    if (navigator.onLine && token) {
      synchronizeOfflineData(token);
    }

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [token]);

  return (
    <ToastProvider>
      <Router>
        <div className="min-h-screen bg-background text-foreground">
          {isLoggedIn && (
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
                      onClick={() => {
                        console.log('Hamburger clicked, current state:', isMobileMenuOpen);
                        setIsMobileMenuOpen(!isMobileMenuOpen);
                      }}
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
                        <Link
                          to="/markdown-calculator"
                          className="hover:opacity-90 transition-opacity"
                        >
                          Markdown Calculator
                        </Link>
                      </li>
                      {userRole === 'Manager' && (
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
        </div>
      </Router>
    </ToastProvider>
  );
}

export default App;
