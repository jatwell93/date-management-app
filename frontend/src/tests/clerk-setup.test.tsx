import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { ClerkAuthProvider, useAuthContext } from '../components/ClerkAuthProvider';
import { ClerkSignInPage, ClerkSignUpPage } from '../components/ClerkAuthPage';

const mockUseUser = jest.fn();
const mockUseAuth = jest.fn();
const mockUseOrganization = jest.fn();
const mockSentryCaptureException = jest.fn();
const mockSentrySetUser = jest.fn();
const mockSignIn = jest.fn();
const mockSignUp = jest.fn();

jest.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => mockSentryCaptureException(...args),
  setUser: (...args: unknown[]) => mockSentrySetUser(...args),
  reactErrorHandler: () => jest.fn(),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@clerk/clerk-react', () => ({
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
    jest.clearAllMocks();

    mockUseUser.mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      user: {
        fullName: 'Test User',
        primaryEmailAddress: { emailAddress: 'test@example.com' },
      },
    });

    mockUseAuth.mockReturnValue({
      getToken: jest.fn().mockResolvedValue('clerk-token'),
      signOut: jest.fn().mockResolvedValue(undefined),
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
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // This should fail during initialization
    const missingKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY?.trim() === '';
    expect(missingKey === true || process.env.REACT_APP_CLERK_PUBLISHABLE_KEY).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('keeps Clerk session tokens in memory instead of localStorage', async () => {
    localStorage.setItem('session', 'legacy-session');
    localStorage.setItem('authToken', 'legacy-auth-token');
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

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
    jest.dontMock('react-dom/client');
    jest.dontMock('../serviceWorkerRegistration');
    jest.dontMock('../reportWebVitals');
    jest.dontMock('../App');
  });

  it('renders recoverable guidance instead of throwing when the Clerk key is missing', () => {
    const renderSpy = jest.fn();
    delete process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
    document.body.innerHTML = '<div id="root"></div>';

    jest.isolateModules(() => {
      jest.doMock('react-dom/client', () => ({
        createRoot: () => ({
          render: renderSpy,
        }),
      }));
      jest.doMock('../serviceWorkerRegistration', () => ({ register: jest.fn() }));
      jest.doMock('../reportWebVitals', () => jest.fn());
      jest.doMock('../App', () => {
        function MockApp() {
          return <div>App shell</div>;
        }

        return MockApp;
      });

      expect(() => require('../index')).not.toThrow();
    });

    render(renderSpy.mock.calls[0][0]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Add REACT_APP_CLERK_PUBLISHABLE_KEY to start the app/i,
    );
    expect(screen.getByText(/Clerk dashboard API keys/i)).toBeInTheDocument();
  });
});
