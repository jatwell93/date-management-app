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
  isPlatformAdmin: boolean;
}

interface NavItem {
  to: string;
  label: string;
}

const MOBILE_MENU_ID = 'app-nav-mobile-menu';

const FOCUS_RING =
  'outline-hidden focus-visible:ring-2 focus-visible:ring-semantic-primary-foreground/70';

// Desktop keeps its 36px density for mouse users; touch pointers get the 44px floor.
const DESKTOP_ITEM_CLASS = `inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${FOCUS_RING}`;

const DESKTOP_TRIGGER_CLASS = `${DESKTOP_ITEM_CLASS} cursor-pointer gap-1 hover:bg-semantic-primary-hover`;

const MOBILE_LINK_CLASS = `flex min-h-11 items-center rounded-md px-3 text-base font-medium transition-colors hover:bg-semantic-primary-hover aria-[current=page]:bg-semantic-primary-hover aria-[current=page]:font-semibold ${FOCUS_RING}`;

const MOBILE_SECTION_LABEL_CLASS =
  'mt-2 border-t border-semantic-primary-foreground/20 px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-semantic-primary-foreground';

const REPORT_ITEMS: NavItem[] = [
  { to: '/reports', label: 'Overview Reports' },
  { to: '/detailed-expiry-report', label: 'Markdown Worklist' },
  { to: '/expiry-entries', label: 'All Expiry Entries' },
  { to: '/expired-items', label: 'Expired Items' },
  { to: '/supplier-credits', label: 'Supplier Credits' },
  { to: '/usage-report', label: 'Usage Report' },
];

const ADMIN_MANAGE_ITEMS: NavItem[] = [
  { to: '/csv-upload', label: 'CSV Upload' },
  { to: '/expiry-import', label: 'Expiry Import' },
  { to: '/store-area-management', label: 'Store Areas' },
  { to: '/user-management', label: 'User Management' },
];

const PLATFORM_ITEM: NavItem = { to: '/platform/catalogue', label: 'Platform Catalogue' };

const MOBILE_PRIMARY_ITEMS: NavItem[] = [
  { to: '/scan', label: 'Scan' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
  ...REPORT_ITEMS.slice(1),
  { to: '/markdown-calculator', label: 'Markdown Calculator' },
];

const MOBILE_ADMIN_ITEMS: NavItem[] = [
  ...ADMIN_MANAGE_ITEMS,
  { to: '/settings', label: 'Settings' },
];

const ACCOUNT_ITEMS: NavItem[] = [
  { to: '/profile', label: 'Profile' },
  { to: '/subscription', label: 'Billing' },
];

function MenuLinks({ items }: { items: NavItem[] }) {
  return items.map((item) => (
    <DropdownMenuItem key={item.to} asChild>
      <Link to={item.to}>{item.label}</Link>
    </DropdownMenuItem>
  ));
}

function DesktopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.to;
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className={`${DESKTOP_ITEM_CLASS} ${
        isActive
          ? 'bg-semantic-primary-foreground text-semantic-primary'
          : 'hover:bg-semantic-primary-hover'
      }`}
    >
      {item.label}
    </Link>
  );
}

interface MobileLinksProps {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}

function MobileLinks({ items, pathname, onNavigate }: MobileLinksProps) {
  return items.map((item) => (
    <Link
      key={item.to}
      to={item.to}
      aria-current={pathname === item.to ? 'page' : undefined}
      className={MOBILE_LINK_CLASS}
      onClick={onNavigate}
    >
      {item.label}
    </Link>
  ));
}

export function AppNav({
  effectiveUserRole,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  handleLogout,
  pathname,
  isPlatformAdmin,
}: AppNavProps) {
  const hasAdminAccess =
    !!effectiveUserRole && hasPermission(effectiveUserRole, PERMISSIONS.MANAGE_MEMBERS);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const mobileLinkProps = { pathname, onNavigate: closeMobileMenu };

  return (
    <nav
      aria-label="Main"
      className="border-b border-semantic-primary-hover/30 bg-semantic-primary text-semantic-primary-foreground shadow-xs"
    >
      <div className="mx-auto max-w-7xl px-4">
        <div
          className="flex min-h-20 items-center justify-between gap-4"
          data-testid="app-nav-shell-row"
        >
          <Link
            to="/scan"
            className={`inline-flex min-h-11 items-center rounded-md font-heading text-lg font-semibold leading-tight hover:opacity-90 ${FOCUS_RING}`}
          >
            Inventory Manager
          </Link>

          <ul className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            <li data-testid="desktop-primary-nav-item" data-nav-label="Scan">
              <DesktopLink item={{ to: '/scan', label: 'Scan' }} pathname={pathname} />
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Dashboard">
              <DesktopLink item={{ to: '/dashboard', label: 'Dashboard' }} pathname={pathname} />
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Reports">
              <DropdownMenu>
                <DropdownMenuTrigger className={DESKTOP_TRIGGER_CLASS}>
                  Reports
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <MenuLinks items={REPORT_ITEMS} />
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Manage">
              <DropdownMenu>
                <DropdownMenuTrigger className={DESKTOP_TRIGGER_CLASS}>
                  Manage
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-56"
                  data-testid="desktop-manage-menu"
                >
                  <MenuLinks
                    items={[{ to: '/markdown-calculator', label: 'Markdown Calculator' }]}
                  />
                  {hasAdminAccess && <MenuLinks items={ADMIN_MANAGE_ITEMS} />}
                  {isPlatformAdmin && <MenuLinks items={[PLATFORM_ITEM]} />}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li data-testid="desktop-primary-nav-item" data-nav-label="Account">
              <DropdownMenu>
                <DropdownMenuTrigger className={DESKTOP_TRIGGER_CLASS}>
                  Account
                  <ChevronDown className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <MenuLinks items={ACCOUNT_ITEMS} />
                  {hasAdminAccess && <MenuLinks items={[{ to: '/settings', label: 'Settings' }]} />}
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
            className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-semantic-primary-foreground transition-colors hover:bg-semantic-primary-hover lg:hidden ${FOCUS_RING}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
            aria-controls={MOBILE_MENU_ID}
          >
            {isMobileMenuOpen ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div
            id={MOBILE_MENU_ID}
            className="border-t border-semantic-primary-foreground/20 py-3 lg:hidden"
          >
            <div className="grid gap-1">
              <MobileLinks items={MOBILE_PRIMARY_ITEMS} {...mobileLinkProps} />
              {hasAdminAccess && (
                <>
                  <div className={MOBILE_SECTION_LABEL_CLASS}>Manage</div>
                  <MobileLinks items={MOBILE_ADMIN_ITEMS} {...mobileLinkProps} />
                </>
              )}
              {isPlatformAdmin && <MobileLinks items={[PLATFORM_ITEM]} {...mobileLinkProps} />}
              <div className={MOBILE_SECTION_LABEL_CLASS}>Account</div>
              <MobileLinks items={ACCOUNT_ITEMS} {...mobileLinkProps} />
              <button
                type="button"
                onClick={() => {
                  handleLogout();
                  closeMobileMenu();
                }}
                className={`mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-base font-medium text-semantic-primary-foreground transition-colors hover:bg-semantic-primary-hover ${FOCUS_RING}`}
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
