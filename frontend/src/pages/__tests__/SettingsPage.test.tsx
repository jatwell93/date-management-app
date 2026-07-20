import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SettingsPage } from '../SettingsPage';

const mockOrganizationProfile = vi.fn();
const mockCaptureException = vi.fn();
let mockShouldThrowOrganizationProfile = false;
const globalsCss = readFileSync(join(__dirname, '..', '..', 'globals.css'), 'utf8');

vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => null,
  SignUp: () => null,
  OrganizationProfile: (props: unknown) => {
    if (mockShouldThrowOrganizationProfile) {
      throw new Error('Clerk organization profile failed to render');
    }

    mockOrganizationProfile(props);
    return <div data-testid="clerk-organization-profile">Clerk organization</div>;
  },
}));

vi.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// The markdown matrix section is exercised by its own test; stub it here so this
// suite stays focused on the Clerk workspace surface and its error boundary.
vi.mock('../../components/MarkdownMatrixSettings', () => ({
  MarkdownMatrixSettings: () => <div data-testid="markdown-matrix-settings" />,
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    mockOrganizationProfile.mockClear();
    mockCaptureException.mockClear();
    mockShouldThrowOrganizationProfile = false;
  });

  it('uses a single un-nested Clerk surface for workspace settings', () => {
    render(<SettingsPage />);

    const shell = screen.getByTestId('settings-shell');
    expect(shell).toHaveClass('bg-semantic-surface-1', 'border-hairline');
    expect(shell).not.toHaveClass('profile-color-field');
    expect(shell).toHaveClass('overflow-x-hidden');
    expect(screen.getByLabelText('Pharmacy workspace controls')).toHaveClass(
      'clerk-responsive-surface',
    );
    expect(screen.queryByText('Organisation Profile')).not.toBeInTheDocument();
  });

  it('derives Clerk adapter colors from semantic CSS variables', () => {
    expect(globalsCss).not.toContain('.profile-color-field');
    expect(globalsCss).not.toMatch(/--clerk-pharmiq-[^:]+:\s*oklch\(/);
    expect(globalsCss).toContain('--clerk-pharmiq-surface: var(--surface-1);');
    expect(globalsCss).toContain('--clerk-pharmiq-primary: var(--semantic-primary);');
    expect(globalsCss).toContain('--clerk-pharmiq-text: var(--text-primary);');
  });

  it('keeps the shell resilient to long translated copy and narrow Clerk content', () => {
    render(<SettingsPage />);

    const shell = screen.getByTestId('settings-shell');
    expect(shell).toHaveClass('min-w-0');
    expect(screen.getByRole('heading', { name: 'Workspace settings' })).toHaveClass('break-words');
    expect(
      screen.getByText('Manage pharmacy workspace details, team access, and roles.'),
    ).toHaveClass('break-words');
    expect(screen.getByLabelText('Pharmacy workspace controls')).toHaveClass('min-w-0');
  });

  it('adapts organization controls for touch and narrow settings viewports', () => {
    mockShouldThrowOrganizationProfile = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<SettingsPage />);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(screen.getByLabelText('Pharmacy workspace controls')).toHaveClass(
      'settings-clerk-adapter',
    );
    expect(screen.getByRole('button', { name: 'Reload settings' })).toHaveClass(
      'w-full',
      'sm:w-auto',
    );
  });

  it('passes the PharmIQ responsive Clerk appearance into organization settings', () => {
    render(<SettingsPage />);

    expect(mockOrganizationProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: 'path',
        path: '/settings',
        appearance: expect.objectContaining({
          variables: expect.objectContaining({
            colorPrimary: expect.stringContaining('oklch'),
            colorBackground: expect.stringContaining('oklch'),
            colorForeground: expect.stringContaining('oklch'),
          }),
          elements: expect.objectContaining({
            rootBox: expect.stringContaining('max-w-full'),
            cardBox: expect.stringContaining('max-w-full'),
            profileSectionPrimaryButton: expect.stringContaining(
              'focus-visible:ring-semantic-primary',
            ),
          }),
        }),
      }),
    );
  });

  it('shows a recoverable settings fallback when Clerk organization controls fail', () => {
    mockShouldThrowOrganizationProfile = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<SettingsPage />);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(screen.queryByTestId('clerk-organization-profile')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace settings could not be loaded.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reload settings before changing team members or roles.',
    );
    expect(screen.getByRole('button', { name: 'Reload settings' })).toHaveAttribute(
      'data-slot',
      'button',
    );
    expect(screen.getByRole('button', { name: 'Reload settings' })).toHaveClass(
      'min-h-11',
      'sm:w-auto',
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          componentStack: expect.any(String),
        }),
      }),
    );
  });
});
