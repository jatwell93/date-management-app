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
import "./globals.css"; // Import the global CSS for Tailwind

// Helper function to decode JWT and get role (mock implementation)
const decodeTokenAndGetRole = (
  token: string | null,
): "Manager" | "Team Member" | null => {
  if (!token) return null;
  // In a real application, you would decode the JWT to get the role.
  // For this mock, we'll assume a simple check.
  if (token.includes("manager")) {
    return "Manager";
  } else if (token.includes("team-member")) {
    return "Team Member";
  }
  return "Team Member"; // Default role if not specified
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
      <div className="min-h-screen bg-gray-100">
        {isLoggedIn && (
          <nav className="bg-primary text-primary-foreground p-4 shadow-md">
            <ul className="flex space-x-4">
              <li>
                <Link to="/scan" className="hover:underline">
                  Scan
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="hover:underline">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/reports" className="hover:underline">
                  Reports
                </Link>
              </li>
              <li>
                <Link to="/usage-report" className="hover:underline">
                  Usage Report
                </Link>
              </li>
              <li>
                <Link to="/markdown-calculator" className="hover:underline">
                  Markdown Calculator
                </Link>
              </li>
              {userRole === "Manager" && (
                <>
                  <li>
                    <Link to="/user-management" className="hover:underline">
                      User Management
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/store-area-management"
                      className="hover:underline"
                    >
                      Store Areas
                    </Link>
                  </li>
                </>
              )}
              <li>
                <button onClick={handleLogout} className="hover:underline">
                  Logout
                </button>
              </li>
            </ul>
          </nav>
        )}

        <main className="p-4">
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
                isLoggedIn ? <MarkdownCalculator /> : <Navigate to="/login" />
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
