import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
} from "react-router-dom";
import { LoginPage } from "./components/LoginPage";
import { ScanPage } from "./pages/ScanPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReportsPage } from "./pages/ReportsPage";
import { UsageReportPage } from "./pages/UsageReportPage";
import { MarkdownCalculator } from "./components/MarkdownCalculator";
import { UserManagementPage } from "./pages/UserManagementPage";
import { StoreAreaManagementPage } from "./pages/StoreAreaManagementPage";
import { synchronizeOfflineData } from "./lib/sync-manager";
import { jwtDecode } from "jwt-decode";

// Helper function to decode JWT and get role
const decodeTokenAndGetRole = (
  token: string | null,
): "Manager" | "Team Member" | null => {
  if (!token) return null;
  try {
    const decodedToken: any = jwtDecode(token);
    const role = decodedToken.role;
    console.log("Decoded token role:", role);
    if (role === "Manager") {
      return "Manager";
    } else if (role === "Team Member") {
      return "Team Member";
    }
    console.log("Unknown role in token, defaulting to Team Member");
    return "Team Member"; // Default role if not specified
  } catch (error) {
    console.error("Error decoding token:", error);
    return "Team Member"; // Default to Team Member on error
  }
};

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem("authToken") ? true : false;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem("authToken");
  });
  const [userRole, setUserRole] = useState<"Manager" | "Team Member" | null>(
    () => {
      return decodeTokenAndGetRole(localStorage.getItem("authToken"));
    },
  );

  const handleLogin = (newToken: string) => {
    localStorage.setItem("authToken", newToken);
    setIsLoggedIn(true);
    setToken(newToken);
    setUserRole(decodeTokenAndGetRole(newToken));
  };

  const handleLogout = () => {
    localStorage.removeItem("authToken");
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
      synchronizeOfflineData(token);
    };

    // Initial synchronization attempt if online
    if (navigator.onLine) {
      synchronizeOfflineData(token);
    }

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [token]);

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        {isLoggedIn && (
          <nav className="bg-primary text-primary-foreground p-4 shadow-md">
            <div className="container mx-auto flex items-center justify-between">
              <div className="flex items-center space-x-8">
                <Link
                  to="/scan"
                  className="font-semibold hover:opacity-90 transition-opacity"
                >
                  <h1 className="text-xl">Inventory Manager</h1>
                </Link>
                <ul className="hidden md:flex space-x-6">
                  <li>
                    <Link
                      to="/scan"
                      className="hover:opacity-90 transition-opacity"
                    >
                      Scan
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/dashboard"
                      className="hover:opacity-90 transition-opacity"
                    >
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/reports"
                      className="hover:opacity-90 transition-opacity"
                    >
                      Reports
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/usage-report"
                      className="hover:opacity-90 transition-opacity"
                    >
                      Usage Report
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/markdown-calculator"
                      className="hover:opacity-90 transition-opacity"
                    >
                      Markdown Calculator
                    </Link>
                  </li>
                  {userRole === "Manager" && (
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
                    </>
                  )}
                </ul>
              </div>
              <div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
                >
                  Logout
                </button>
              </div>
            </div>
          </nav>
        )}

        <main className="p-4 max-w-7xl mx-auto">
          <Routes>
            <Route
              path="/login"
              element={
                isLoggedIn ? (
                  <Navigate to="/scan" />
                ) : (
                  <LoginPage onLogin={handleLogin} />
                )
              }
            />
            <Route
              path="/scan"
              element={
                isLoggedIn ? (
                  <ScanPage token={token} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/dashboard"
              element={
                isLoggedIn ? (
                  <DashboardPage token={token} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/reports"
              element={
                isLoggedIn ? (
                  <ReportsPage token={token} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/usage-report"
              element={
                isLoggedIn ? (
                  <UsageReportPage token={token} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/markdown-calculator"
              element={
                isLoggedIn ? (
                  <MarkdownCalculator token={token} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            {userRole === "Manager" && (
              <>
                <Route
                  path="/user-management"
                  element={
                    isLoggedIn ? (
                      <UserManagementPage token={token} />
                    ) : (
                      <Navigate to="/login" />
                    )
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
              </>
            )}
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
