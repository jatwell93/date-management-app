import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { OnboardingPage } from '../OnboardingPage';
import { apiService } from '../../lib/api.service';

const mockGetToken = vi.fn();
const mockOrganization = { current: null as { id: string } | null };

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useOrganization: () => ({ organization: mockOrganization.current, isLoaded: true }),
  CreateOrganization: () => <div data-testid="clerk-create-organization" />,
}));

vi.mock('../../lib/api.service', () => ({
  apiService: { post: vi.fn() },
}));

const mockPost = vi.mocked(apiService.post);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderOnboarding(initialEntry = '/onboarding') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<div>Elsewhere</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  mockOrganization.current = { id: 'org_1' };
  mockGetToken.mockResolvedValue('token');
});

describe('OnboardingPage structure', () => {
  it('renders a labelled region with the step heading and step count', () => {
    mockOrganization.current = null;
    renderOnboarding();

    expect(screen.getByRole('region', { name: 'Welcome to PharmIQ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-create-organization')).toBeInTheDocument();
  });

  it('does not force a full viewport height inside the app shell', () => {
    mockOrganization.current = null;
    renderOnboarding();
    expect(screen.getByRole('region').className).not.toContain('min-h-screen');
  });

  it('marks the current step in the progress list', () => {
    renderOnboarding('/onboarding?step=1');

    const progress = screen.getByRole('list', { name: 'Onboarding progress' });
    const items = progress.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[0]).toHaveTextContent('(done)');
    expect(items[1]).toHaveClass('bg-semantic-primary');
    expect(items[2]).toHaveClass('bg-semantic-surface-4');
  });

  it('exposes card titles as level-2 headings', () => {
    renderOnboarding('/onboarding?step=1');
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});

describe('OnboardingPage catalog step', () => {
  it('routes the CSV option to the upload page with a return URL', async () => {
    renderOnboarding('/onboarding?step=1');
    await userEvent.click(screen.getByRole('button', { name: /csv/i }));
    expect(location()).toBe('/csv-upload?return=/onboarding?step=2');
  });

  it('seeds demo data, advances to the tour and focuses the new heading', async () => {
    mockPost.mockResolvedValue({});
    renderOnboarding('/onboarding?step=1');

    await userEvent.click(screen.getByRole('button', { name: /demo data/i }));

    await waitFor(() => expect(screen.getByText('Step 3 of 3')).toBeInTheDocument());
    expect(mockPost).toHaveBeenCalledWith('/api/organization/seed-demo-data', {}, 'token');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('announces a seed failure as an alert and re-enables the options', async () => {
    mockPost.mockRejectedValue(new Error('Server unavailable'));
    renderOnboarding('/onboarding?step=1');

    const demoButton = screen.getByRole('button', { name: /demo data/i });
    await userEvent.click(demoButton);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Server unavailable');
    expect(alert.className).toContain('text-semantic-critical-muted-foreground');
    expect(demoButton).toBeEnabled();
  });
});

describe('OnboardingPage tour step', () => {
  it('marks the current slide and announces slide changes', async () => {
    renderOnboarding('/onboarding?step=2');

    const firstDot = screen.getByRole('button', { name: /^Slide 1 of 3/ });
    expect(firstDot).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Slide 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Slide 2 of 3/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('gives tour controls 44px touch targets', () => {
    renderOnboarding('/onboarding?step=2');

    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: /^Slide 1 of 3/ })).toHaveClass('size-11');
  });

  it('sends the user to the scan page from the last slide', async () => {
    renderOnboarding('/onboarding?step=2');

    await userEvent.click(screen.getByRole('button', { name: /^Slide 3 of 3/ }));
    expect(screen.queryByRole('button', { name: /go to dashboard/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start scanning' }));

    expect(location()).toBe('/scan');
  });
});
