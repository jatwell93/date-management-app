import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { API_AUTH_UNAUTHORIZED_EVENT } from './lib/api.service';
import { useAuthContext } from './components/ClerkAuthProvider';

jest.mock('react-router-dom');

jest.mock('./components/ClerkAuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@clerk/clerk-react', () => ({
  UserProfile: () => <div data-testid="clerk-user-profile">Clerk profile</div>,
}));

let mockOrgBootstrapState = {
  isBootstrapped: true,
  isBootstrapping: false,
  bootstrapError: null as string | null,
  bootstrapResult: null as { userId: string; role: string } | null,
  retry: jest.fn(),
};

// Mock useOrgBootstrap to avoid Clerk hooks
jest.mock('./hooks/useOrgBootstrap', () => ({
  useOrgBootstrap: () => mockOrgBootstrapState,
}));

// Mock child page components to avoid their imports
jest.mock('./pages/ScanPage', () => ({
  ScanPage: () => null,
}));

jest.mock('./components/StorageQuotaWarning', () => ({
  StorageQuotaWarning: () => null,
}));

jest.mock('./components/TrialBanner', () => ({
  TrialBanner: () => null,
}));

jest.mock('./contexts/HandheldContext', () => ({
  HandheldProvider: ({ children }: { children: React.ReactNode }) => children,
  useHandheldDetectionContext: () => ({ isHandheld: false }),
}));

jest.mock('./components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const App = require('./App').default;

const mockSignedInContext = (overrides = {}) => {
  (useAuthContext as jest.Mock).mockReturnValue({
    isLoading: false,
    isLoggedIn: true,
    isFullySignedIn: true,
    userId: 'user-1',
    userName: 'Test User',
    userRole: 'admin',
    updateBootstrapRole: jest.fn(),
    token: 'test-token',
    handleLogout: jest.fn(),
    ...overrides,
  });
};

beforeEach(() => {
  mockOrgBootstrapState = {
    isBootstrapped: true,
    isBootstrapping: false,
    bootstrapError: null,
    bootstrapResult: null,
    retry: jest.fn(),
  };
  jest.clearAllMocks();
});

describe('App unauthorized event handling', () => {
  it('should call handleLogout when unauthorized event is fired', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handleLogout = jest.fn();

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

    fireEvent.click(screen.getByLabelText('Toggle mobile menu'));

    expect(screen.queryByText('Sentry Test')).not.toBeInTheDocument();
  });

  it('keeps Billing inside Account navigation without a standalone top-level tab', () => {
    mockSignedInContext();

    render(<App />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Account')).toBeInTheDocument();
    expect(within(nav).getAllByText('Billing')).toHaveLength(1);
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
});

export {};
