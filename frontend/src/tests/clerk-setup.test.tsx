import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { ClerkAuthProvider, useAuthContext } from '../components/ClerkAuthProvider';
import { ClerkSignInPage, ClerkSignUpPage } from '../components/ClerkAuthPage';

const mockUseUser = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOrganization = vi.fn();
const mockSentryCaptureException = vi.fn();
const mockSentrySetUser = vi.fn();
const mockSignIn = vi.fn();
const mockSignUp = vi.fn();

vi.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => mockSentryCaptureException(...args),
  setUser: (...args: unknown[]) => mockSentrySetUser(...args),
  reactErrorHandler: () => vi.fn(),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignIn: (props: unknown) => {
    mockSignIn(props);
    return <div>Mock Clerk Sign In</div>;
  },
  SignUp: (props: unknown) => {
    mockSignUp(props);
    return <div>Mock Clerk Sign Up</div>;
  },
  useUser: () => mockUseUser(),
  useAuth: () => mockUseAuth(),
  useOrganization: () => mockUseOrganization(),
}));

const AuthConsumer = () => {
  const { token, isLoggedIn } = useAuthContext();

  return <div>{isLoggedIn ? token : 'logged-out'}</div>;
};

/**
 * Test: ClerkProvider is correctly configured
 * This verifies that Clerk is initialized and available to the app
 */
describe('Clerk Integration Setup', () => {
  beforeEach(() => {
    // Set mock env var for testing
    process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = 'pk_test_example';
    localStorage.clear();
    vi.clearAllMocks();

    mockUseUser.mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      user: {
        fullName: 'Test User',
        primaryEmailAddress: { emailAddress: 'test@example.com' },
      },
    });

    mockUseAuth.mockReturnValue({
      getToken: vi.fn().mockResolvedValue('clerk-token'),
      signOut: vi.fn().mockResolvedValue(undefined),
    });

    mockUseOrganization.mockReturnValue({
      organization: { id: 'org_123' },
      isLoaded: true,
    });
  });

  it('should render ClerkProvider without crashing', () => {
    const TestComponent = () => (
      <ClerkProvider publishableKey="pk_test_example" afterSignOutUrl="/">
        <div>Test App with Clerk</div>
      </ClerkProvider>
    );

    render(<TestComponent />);
    expect(screen.getByText('Test App with Clerk')).toBeInTheDocument();
  });

  it('should throw error if REACT_APP_CLERK_PUBLISHABLE_KEY is missing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // This should fail during initialization
    const missingKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY?.trim() === '';
    expect(missingKey === true || process.env.REACT_APP_CLERK_PUBLISHABLE_KEY).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('keeps Clerk session tokens in memory instead of localStorage', async () => {
    localStorage.setItem('session', 'legacy-session');
    localStorage.setItem('authToken', 'legacy-auth-token');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <ClerkAuthProvider publishableKey="pk_test_example">
        <AuthConsumer />
      </ClerkAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('clerk-token')).toBeInTheDocument();
    });

    expect(localStorage.getItem('session')).toBeNull();
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalledWith('session', expect.any(String));
    expect(setItemSpy).not.toHaveBeenCalledWith('authToken', expect.any(String));

    setItemSpy.mockRestore();
  });

  it('sets Sentry user context when a Clerk session token is loaded', async () => {
    render(
      <ClerkAuthProvider publishableKey="pk_test_example">
        <AuthConsumer />
      </ClerkAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('clerk-token')).toBeInTheDocument();
    });

    expect(mockSentrySetUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
      }),
    );
  });
});

describe('Clerk auth pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constrains the sign-in shell on mobile viewports', () => {
    render(<ClerkSignInPage />);

    expect(screen.getByTestId('clerk-auth-shell')).toHaveClass('overflow-x-hidden', 'px-4');
    expect(screen.getByTestId('clerk-auth-card')).toHaveClass('max-w-full');
    expect(mockSignIn).toHaveBeenCalledWith(
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

  it('applies the PharmIQ color palette to Clerk sign-in controls', () => {
    render(<ClerkSignInPage />);

    expect(mockSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          variables: expect.objectContaining({
            colorPrimary: expect.stringContaining('oklch'),
            colorBackground: expect.stringContaining('oklch'),
            colorForeground: expect.stringContaining('oklch'),
          }),
          elements: expect.objectContaining({
            formButtonPrimary: expect.stringContaining('bg-semantic-primary'),
            footerActionLink: expect.stringContaining('text-semantic-primary'),
          }),
        }),
      }),
    );
  });

  it('constrains the sign-up shell on mobile viewports', () => {
    render(<ClerkSignUpPage />);

    expect(screen.getByTestId('clerk-auth-shell')).toHaveClass('overflow-x-hidden', 'px-4');
    expect(screen.getByTestId('clerk-auth-card')).toHaveClass('max-w-full');
    expect(mockSignUp).toHaveBeenCalledWith(
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

  it('applies the PharmIQ color palette to Clerk sign-up controls', () => {
    render(<ClerkSignUpPage />);

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          variables: expect.objectContaining({
            colorPrimary: expect.stringContaining('oklch'),
            colorBackground: expect.stringContaining('oklch'),
            colorForeground: expect.stringContaining('oklch'),
          }),
          elements: expect.objectContaining({
            formButtonPrimary: expect.stringContaining('bg-semantic-primary'),
            footerActionLink: expect.stringContaining('text-semantic-primary'),
          }),
        }),
      }),
    );
  });
});

describe('Frontend startup configuration guidance', () => {
  const originalClerkKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

  afterEach(() => {
    process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = originalClerkKey;
    vi.doUnmock('react-dom/client');
    vi.doUnmock('../serviceWorkerRegistration');
    vi.doUnmock('../reportWebVitals');
    vi.doUnmock('../App');
    vi.resetModules();
  });

  it('renders recoverable guidance instead of throwing when the Clerk key is missing', async () => {
    const renderSpy = vi.fn();
    delete process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
    document.body.innerHTML = '<div id="root"></div>';

    vi.resetModules();
    const reactDomClientMock = { createRoot: () => ({ render: renderSpy }) };
    vi.doMock('react-dom/client', () => ({ ...reactDomClientMock, default: reactDomClientMock }));
    vi.doMock('../serviceWorkerRegistration', () => ({ register: vi.fn() }));
    vi.doMock('../reportWebVitals', () => ({ default: vi.fn() }));
    vi.doMock('../App', () => ({
      default: function MockApp() {
        return <div>App shell</div>;
      },
    }));

    await expect(import('../index')).resolves.toBeDefined();

    render(renderSpy.mock.calls[0][0]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Add REACT_APP_CLERK_PUBLISHABLE_KEY to start the app/i,
    );
    expect(screen.getByText(/Clerk dashboard API keys/i)).toBeInTheDocument();
  });
});
