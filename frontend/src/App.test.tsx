import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { API_AUTH_UNAUTHORIZED_EVENT } from './lib/api.service';
import { useAuthContext } from './components/ClerkAuthProvider';
import type { RoleValue } from './constants/roles';
// eslint-disable-next-line jest/no-mocks-import -- intentionally read the shared manual mock's navigate spy
import { mockNavigate } from './__mocks__/react-router-dom';

vi.mock('react-router-dom', () => import('./__mocks__/react-router-dom'));

vi.mock('./hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, vi.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

vi.mock('./components/ClerkAuthProvider', () => ({
  useAuthContext: vi.fn(),
}));

const mockUserProfile = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  UserProfile: (props: unknown) => {
    mockUserProfile(props);
    return <div data-testid="clerk-user-profile">Clerk profile</div>;
  },
  OrganizationProfile: () => <div data-testid="clerk-organization-profile">Clerk organization</div>,
}));

let mockOrgBootstrapState = {
  isBootstrapped: true,
  isBootstrapping: false,
  bootstrapError: null as string | null,
  bootstrapResult: null as { userId: number; role: RoleValue; organizationId?: string } | null,
  retry: vi.fn(),
};

// Mock useOrgBootstrap to avoid Clerk hooks
vi.mock('./hooks/useOrgBootstrap', () => ({
  useOrgBootstrap: () => mockOrgBootstrapState,
}));

// Mock child page components to avoid their imports
vi.mock('./pages/ScanPage', () => ({
  ScanPage: () => <div data-testid="scan-page">Scan page</div>,
}));

vi.mock('./components/StorageQuotaWarning', () => ({
  StorageQuotaWarning: () => null,
}));

vi.mock('./components/TrialBanner', () => ({
  TrialBanner: () => null,
}));

let mockHandheldContext = {
  isHandheld: false,
  detectionResult: null as null | {
    isHandheld: boolean;
    method: string;
    screenWidth: number;
    screenHeight: number;
  },
  syncStrategy: 'real-time',
  setSyncStrategy: vi.fn(),
};

vi.mock('./contexts/HandheldContext', () => ({
  HandheldProvider: ({ children }: { children: React.ReactNode }) => children,
  useHandheldDetectionContext: () => mockHandheldContext,
}));

vi.mock('./components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuContent: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div role="menu" {...props}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const App = (await import('./App')).default;

const getMockNavigate = () => mockNavigate;

const mockSignedInContext = (overrides = {}) => {
  (useAuthContext as jest.Mock).mockReturnValue({
    isLoading: false,
    isLoggedIn: true,
    isFullySignedIn: true,
    userId: 1,
    userName: 'Test User',
    userRole: 'admin',
    updateBootstrapRole: vi.fn(),
    token: 'test-token',
    handleLogout: vi.fn(),
    ...overrides,
  });
};

beforeEach(() => {
  window.history.pushState({}, '', '/');
  mockHandheldContext = {
    isHandheld: false,
    detectionResult: null,
    syncStrategy: 'real-time',
    setSyncStrategy: vi.fn(),
  };
  mockOrgBootstrapState = {
    isBootstrapped: true,
    isBootstrapping: false,
    bootstrapError: null,
    bootstrapResult: null,
    retry: vi.fn(),
  };
  vi.clearAllMocks();
});

describe('App unauthorized event handling', () => {
  it('should call handleLogout when unauthorized event is fired', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handleLogout = vi.fn();

    (useAuthContext as jest.Mock).mockReturnValue({
      handleLogout,
    });

    render(<App />);

    window.dispatchEvent(
      new CustomEvent(API_AUTH_UNAUTHORIZED_EVENT, {
        detail: { endpoint: '/api/test', status: 401 },
      }),
    );

    await waitFor(() => {
      expect(handleLogout).toHaveBeenCalledTimes(1);
    });
  });
});

describe('App navigation', () => {
  it('does not expose diagnostic Sentry Test navigation for signed-in desktop users', () => {
    mockSignedInContext();

    render(<App />);

    expect(screen.queryByText('Sentry Test')).not.toBeInTheDocument();
  });

  it('does not expose diagnostic Sentry Test navigation for signed-in mobile users', () => {
    mockSignedInContext();

    render(<App />);

    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    expect(screen.queryByText('Sentry Test')).not.toBeInTheDocument();
  });

  it('keeps desktop primary navigation focused on core pharmacy workflows', () => {
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    expect(screen.getByRole('navigation')).toHaveClass('bg-semantic-primary');
    expect(screen.getByTestId('app-nav-shell-row')).toHaveClass('min-h-20');

    const primaryItems = screen.getAllByTestId('desktop-primary-nav-item');
    expect(primaryItems.map((item) => item.getAttribute('data-nav-label'))).toEqual([
      'Scan',
      'Dashboard',
      'Reports',
      'Manage',
      'Account',
    ]);
  });

  it('keeps Billing inside Account navigation without a standalone top-level tab', () => {
    mockSignedInContext();

    render(<App />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Account')).toBeInTheDocument();
    expect(within(nav).getAllByText('Billing')).toHaveLength(1);
  });

  it('groups admin catalog and setup tools under Manage navigation', () => {
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    const manageMenu = screen.getByTestId('desktop-manage-menu');
    expect(within(manageMenu).getByText('Markdown Calculator')).toBeInTheDocument();
    expect(within(manageMenu).getByText('CSV Upload')).toBeInTheDocument();
    expect(within(manageMenu).getByText('Expiry Import')).toBeInTheDocument();
    expect(within(manageMenu).getByText('Store Areas')).toBeInTheDocument();
    expect(within(manageMenu).getByText('User Management')).toBeInTheDocument();
  });

  it('exposes catalog upload navigation for admin users', () => {
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('CSV Upload')).toBeInTheDocument();
  });

  it('hides catalog upload navigation for non-admin users', () => {
    mockSignedInContext({ userRole: 'team_member' });

    render(<App />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByText('CSV Upload')).not.toBeInTheDocument();
  });

  it('uses the current bootstrap role when Clerk token does not include a numeric user id', () => {
    const updateBootstrapRole = vi.fn();
    mockSignedInContext({
      userId: null,
      userRole: null,
      updateBootstrapRole,
    });
    mockOrgBootstrapState = {
      isBootstrapped: true,
      isBootstrapping: false,
      bootstrapError: null,
      bootstrapResult: {
        userId: 1,
        role: 'admin',
        organizationId: 'org_expect',
      },
      retry: vi.fn(),
    };

    render(<App />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('CSV Upload')).toBeInTheDocument();
    expect(within(nav).getByText('User Management')).toBeInTheDocument();
    expect(updateBootstrapRole).toHaveBeenCalledWith('admin');
  });

  it('keeps the handheld shell to one main landmark and routes settings from the scanner toolbar', () => {
    window.history.pushState({}, '', '/scan');
    mockHandheldContext = {
      ...mockHandheldContext,
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
    };
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByTestId('handheld-route-shell')).toHaveClass('h-full min-h-0');
    expect(screen.getByTestId('handheld-route-shell')).not.toHaveClass('p-4');
    expect(screen.getByTestId('handheld-route-shell')).not.toHaveClass('max-w-7xl');

    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));

    expect(getMockNavigate()).toHaveBeenCalledWith('/settings');
  });
});

describe('App loading state', () => {
  it('uses an expiry-domain loading affordance while authentication initializes', () => {
    mockSignedInContext({
      isLoading: true,
      isLoggedIn: false,
      isFullySignedIn: false,
      token: null,
    });

    render(<App />);

    expect(screen.getByText('Checking expiry workspace')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});

describe('App account routes', () => {
  it('centers Clerk profile content inside the app shell', () => {
    window.history.pushState({}, '', '/profile');
    mockSignedInContext();

    render(<App />);

    const profileShell = screen.getByTestId('profile-shell');
    expect(profileShell).toHaveClass('mx-auto');
    expect(profileShell).toHaveClass('max-w-5xl');
    expect(within(profileShell).getByTestId('clerk-user-profile')).toBeInTheDocument();
  });

  it('constrains Clerk profile internals for narrow viewports', () => {
    window.history.pushState({}, '', '/profile');
    mockSignedInContext();

    render(<App />);

    expect(screen.getByTestId('profile-shell')).toHaveClass('overflow-x-hidden');
    expect(mockUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          elements: expect.objectContaining({
            rootBox: expect.stringContaining('max-w-full'),
            cardBox: expect.stringContaining('max-w-full'),
          }),
        }),
      }),
    );
  });

  it('passes the PharmIQ color system into the Clerk profile surface', () => {
    window.history.pushState({}, '', '/profile');
    mockSignedInContext();

    render(<App />);

    expect(screen.getByTestId('profile-shell')).toHaveClass(
      'bg-semantic-surface-1',
      'border-hairline',
    );
    expect(screen.getByTestId('profile-shell')).not.toHaveClass('profile-color-field');
    expect(mockUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          variables: expect.objectContaining({
            colorPrimary: expect.stringContaining('oklch'),
            colorBackground: expect.stringContaining('oklch'),
            colorForeground: expect.stringContaining('oklch'),
          }),
          elements: expect.objectContaining({
            navbarButton: expect.stringContaining('text-semantic-primary'),
            formButtonPrimary: expect.stringContaining('bg-semantic-primary'),
          }),
        }),
      }),
    );
  });

  it('passes visible focus styles into Clerk profile controls', () => {
    window.history.pushState({}, '', '/profile');
    mockSignedInContext();

    render(<App />);

    expect(mockUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          elements: expect.objectContaining({
            navbarButton: expect.stringContaining('focus-visible:ring-semantic-primary'),
            profileSectionPrimaryButton: expect.stringContaining(
              'focus-visible:ring-semantic-primary',
            ),
            menuButton: expect.stringContaining('focus-visible:ring-semantic-primary'),
          }),
        }),
      }),
    );
  });
});

describe('App Expect QA diagnostics', () => {
  const originalQaStatusFlag = process.env.REACT_APP_EXPECT_QA_STATUS;

  afterEach(() => {
    process.env.REACT_APP_EXPECT_QA_STATUS = originalQaStatusFlag;
  });

  it('does not render QA diagnostics unless explicitly enabled', () => {
    delete process.env.REACT_APP_EXPECT_QA_STATUS;
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    expect(screen.queryByTestId('expect-qa-status')).not.toBeInTheDocument();
  });

  it('renders Clerk and bootstrap state for Expect when enabled outside production', () => {
    process.env.REACT_APP_EXPECT_QA_STATUS = 'true';
    mockSignedInContext({
      userId: 42,
      userName: 'Expect Admin',
      userRole: 'admin',
      token: 'test-token',
      hasOrganization: true,
    });
    mockOrgBootstrapState = {
      isBootstrapped: true,
      isBootstrapping: false,
      bootstrapError: null,
      bootstrapResult: {
        userId: 42,
        role: 'team_member',
        organizationId: 'org_expect',
      },
      retry: vi.fn(),
    };

    render(<App />);

    expect(screen.getByTestId('expect-qa-status')).toBeInTheDocument();
    expect(screen.getByTestId('expect-qa-frontend-role')).toHaveTextContent('admin');
    expect(screen.getByTestId('expect-qa-backend-role')).toHaveTextContent('team_member');
    expect(screen.getByTestId('expect-qa-organization-id')).toHaveTextContent('org_expect');
    expect(screen.getByTestId('expect-qa-bootstrap-status')).toHaveTextContent('ready');
    expect(screen.getByTestId('expect-qa-token')).toHaveTextContent('present');
    expect(screen.getByTestId('expect-qa-api-base-url')).toHaveTextContent('http://localhost:3001');
  });

  it('collapses QA diagnostics behind a toggle on narrow screens', () => {
    process.env.REACT_APP_EXPECT_QA_STATUS = 'true';
    window.innerWidth = 480;
    mockSignedInContext({ userRole: 'admin' });

    render(<App />);

    expect(screen.queryByTestId('expect-qa-status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open QA diagnostics/i })).toHaveClass('left-3');

    fireEvent.click(screen.getByRole('button', { name: /Open QA diagnostics/i }));

    expect(screen.getByTestId('expect-qa-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close QA diagnostics/i })).toBeInTheDocument();
  });
});

export {};
