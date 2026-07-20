import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { hasPermission, PERMISSIONS, RoleValue } from '../constants/roles';

interface AppNavProps {
  effectiveUserRole: RoleValue | null;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  handleLogout: () => void;
  pathname: string;
}

export function AppNav({
  effectiveUserRole,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  handleLogout,
  pathname,
}: AppNavProps) {
  const hasAdminAccess =
    !!effectiveUserRole && hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS);

  return (
    <nav className="border-b border-semantic-primary-hover/30 bg-semantic-primary text-semantic-primary-foreground shadow-sm">
      <div className="mx-auto max-w-7xl px-4">
        <div
          className="flex min-h-20 items-center justify-between gap-4"
          data-testid="app-nav-shell-row"
        >
          <Link
            to="/scan"
            className="font-heading text-lg font-semibold leading-tight hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-semantic-primary-foreground/70"
          >
            Inventory Manager
          </Link>

          <ul className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            <li data-testid="desktop-primary-nav-item" data-nav-label="Scan">
              <Link
                to="/scan"
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === '/scan'
                    ? 'bg-semantic-primary-foreground text-semantic-primary'
                    : 'hover:bg-semantic-primary-hover'
                }`}
              >
                Scan
              </Link>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Dashboard">
              <Link
                to="/dashboard"
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === '/dashboard'
                    ? 'bg-semantic-primary-foreground text-semantic-primary'
                    : 'hover:bg-semantic-primary-hover'
                }`}
              >
                Dashboard
              </Link>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Reports">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover focus:outline-none focus:ring-2 focus:ring-semantic-primary-foreground/70">
                  Reports
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/reports">Overview Reports</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/detailed-expiry-report">Markdown Worklist</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/expiry-entries">All Expiry Entries</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/expired-items">Expired Items</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/supplier-credits">Supplier Credits</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/usage-report">Usage Report</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Manage">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover focus:outline-none focus:ring-2 focus:ring-semantic-primary-foreground/70">
                  Manage
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-56"
                  data-testid="desktop-manage-menu"
                >
                  <DropdownMenuItem asChild>
                    <Link to="/markdown-calculator">Markdown Calculator</Link>
                  </DropdownMenuItem>
                  {hasAdminAccess && (
                    <>
                      <DropdownMenuItem asChild>
                        <Link to="/csv-upload">CSV Upload</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/expiry-import">Expiry Import</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/store-area-management">Store Areas</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/user-management">User Management</Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Account">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover focus:outline-none focus:ring-2 focus:ring-semantic-primary-foreground/70">
                  Account
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem asChild>
                    <Link to="/profile">Profile</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/subscription">Billing</Link>
                  </DropdownMenuItem>
                  {hasAdminAccess && (
                    <DropdownMenuItem asChild>
                      <Link to="/settings">Settings</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" asChild>
                    <button type="button" onClick={handleLogout} className="w-full">
                      <LogOut className="size-4" aria-hidden="true" />
                      Logout
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </ul>

          <button
            type="button"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-semantic-primary-foreground transition-colors hover:bg-semantic-primary-hover focus:outline-none focus:ring-2 focus:ring-semantic-primary-foreground/70 lg:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="border-t border-semantic-primary-foreground/20 py-3 lg:hidden">
            <div className="grid gap-1">
              {[
                { to: '/scan', label: 'Scan' },
                { to: '/dashboard', label: 'Dashboard' },
                { to: '/reports', label: 'Reports' },
                { to: '/detailed-expiry-report', label: 'Markdown Worklist' },
                { to: '/expiry-entries', label: 'All Expiry Entries' },
                { to: '/expired-items', label: 'Expired Items' },
                { to: '/supplier-credits', label: 'Supplier Credits' },
                { to: '/usage-report', label: 'Usage Report' },
                { to: '/markdown-calculator', label: 'Markdown Calculator' },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              {hasAdminAccess && (
                <>
                  <div className="mt-2 border-t border-semantic-primary-foreground/20 px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-semantic-primary-foreground/75">
                    Manage
                  </div>
                  {[
                    { to: '/csv-upload', label: 'CSV Upload' },
                    { to: '/expiry-import', label: 'Expiry Import' },
                    { to: '/store-area-management', label: 'Store Areas' },
                    { to: '/user-management', label: 'User Management' },
                    { to: '/settings', label: 'Settings' },
                  ].map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </>
              )}
              <div className="mt-2 border-t border-semantic-primary-foreground/20 px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-semantic-primary-foreground/75">
                Account
              </div>
              {[
                { to: '/profile', label: 'Profile' },
                { to: '/subscription', label: 'Billing' },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-semantic-primary-hover"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  handleLogout();
                  setIsMobileMenuOpen(false);
                }}
                className="mt-1 flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-semantic-critical-muted transition-colors hover:bg-semantic-primary-hover"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
