import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import { ReportsPage } from '../pages/ReportsPage';
import { apiService } from '../lib/api.service';

vi.mock('../hooks/useFreshApiToken', () => {
  const getToken = vi.fn().mockResolvedValue('token');
  return { useFreshApiToken: () => getToken };
});

vi.mock('../lib/api.service', () => ({
  apiService: { get: vi.fn() },
}));

const overall = {
  month: 'Overall',
  total_expiring: 100,
  expired_count: 50,
  total_markdown: 50,
  expiry_risk_count: 3,
  next_month_markdown_count: 7,
  active_expiry_stock_count: 45,
  latest_expiry_date: '2025-12-31',
};

function mockReports() {
  vi.mocked(apiService.get).mockImplementation((url: string) => {
    if (url === '/reports/expiry') {
      return Promise.resolve([
        { ...overall, month: '2025-08', latest_expiry_date: '2025-08-31' },
        { ...overall, month: null, latest_expiry_date: null },
        { ...overall, month: null, latest_expiry_date: null },
      ]);
    }
    if (url === '/reports/expiry-overall') return Promise.resolve(overall);
    if (url === '/reports/sell-through') {
      return Promise.resolve([{ markdownLevel: 1, soldCount: 4 }]);
    }
    return Promise.reject(new Error('Unknown URL'));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportsPage token="token" />
    </MemoryRouter>,
  );
}

describe('ReportsPage UI audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes each report section as a level-2 heading under the h1', async () => {
    mockReports();
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Sell-through by markdown level' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Expiry reporting' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Expiry action summary' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Monthly expiry report' })).toBeVisible();
  });

  it('does not render a nested main landmark inside the app shell', async () => {
    mockReports();
    renderPage();

    expect(
      await screen.findByRole('region', { name: 'Expiry reporting workspace' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('uses AA-contrast text tokens for the summary metrics', async () => {
    mockReports();
    renderPage();

    const risk = await screen.findByRole('region', { name: 'Primary expiry decision' });
    expect(risk.querySelector('.text-semantic-critical')).toBeNull();
    expect(screen.getByText('45')).toHaveClass('text-semantic-text-primary');
    expect(screen.getByText('7')).toHaveClass('text-semantic-warning-muted-foreground');
  });

  it('gives quick links a 44px minimum touch target', async () => {
    mockReports();
    renderPage();

    for (const name of ['Open next 90 days', 'Open all expiry entries', 'Review expired items']) {
      expect(await screen.findByRole('link', { name })).toHaveClass('min-h-11');
    }
  });

  it('navigates quick links client-side through the router', async () => {
    mockReports();
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportsPage token="token" />} />
          <Route path="/expired-items" element={<p>Expired items route</p>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: 'Review expired items' });
    expect(link).toHaveAttribute('href', '/expired-items');
    fireEvent.click(link);
    expect(await screen.findByText('Expired items route')).toBeInTheDocument();
  });

  it('gates skeleton pulse on reduced motion and keeps skeletons within narrow viewports', () => {
    vi.mocked(apiService.get).mockReturnValue(new Promise(() => {}));
    renderPage();

    const loading = screen.getByRole('status', { name: 'Loading expiry reports' });
    const pulsing = loading.querySelectorAll('[class*="animate-pulse"]');
    expect(pulsing.length).toBeGreaterThan(0);
    pulsing.forEach((el) => {
      expect(el.className).not.toMatch(/(^|\s)animate-pulse/);
      expect(el).toHaveClass('motion-safe:animate-pulse');
    });
    expect(loading.querySelector('.w-96')).toBeNull();
  });

  it('sets metrics in tabular numerals with no sub-14px copy and no duplicate row keys', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReports();
    const { container } = renderPage();

    const risk = await screen.findByRole('region', { name: 'Primary expiry decision' });
    await screen.findByRole('heading', { level: 2, name: 'Sell-through by markdown level' });
    expect(screen.getByText('3')).toHaveClass('tabular-nums', 'text-2xl');
    expect(risk.querySelector('.text-3xl')).toBeNull();
    expect(screen.getByText('45')).toHaveClass('tabular-nums');
    expect(screen.getByText('4')).toHaveClass('tabular-nums');
    expect(container.querySelector('.text-xs:not(th)')).toBeNull();
    expect(screen.getByRole('link', { name: 'Review expired items' })).not.toHaveClass(
      'bg-semantic-critical',
    );
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(
      false,
    );
    consoleError.mockRestore();
  });

  it('keeps a page heading and a full-size retry button when every report fails', async () => {
    vi.mocked(apiService.get).mockRejectedValue(new Error('Failed to load report'));
    renderPage();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(retry).toHaveClass('min-h-11');
    expect(screen.getByRole('heading', { level: 1, name: 'Expiry reporting' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load report');
  });
});
