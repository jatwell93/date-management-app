import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExpiryEntriesPage } from '../pages/ExpiryEntriesPage';
import { apiService } from '../lib/api.service';
import { ROLES } from '../constants/roles';
import '@testing-library/jest-dom';

vi.mock('../hooks/useFreshApiToken', () => ({
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

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

// Includes a far-future item (365 days) that the 90-day worklist would hide —
// exactly the kind of data-entry error this page exists to surface and fix.
const twoLocationRows = [
  {
    inventoryId: 1,
    expiryDate: daysFromNow(20),
    status: 'Markdown 3',
    productId: 20,
    productName: 'Front Counter Product',
    sku: 'SKU-1',
    costPrice: 12.5,
    locationId: 2,
    locationName: 'Front Counter',
    subDepartment: 'Cold and Flu',
  },
  {
    inventoryId: 2,
    expiryDate: daysFromNow(365),
    status: 'Normal',
    productId: 21,
    productName: 'Aisle One Product',
    sku: 'SKU-2',
    costPrice: 4,
    locationId: 3,
    locationName: 'Aisle 1',
    subDepartment: 'Pain Relief',
  },
];

function mockApi() {
  // @ts-expect-error — apiService.get is mocked as vi.fn()
  apiService.get.mockImplementation((url) => {
    if (url === '/reports/expiry-entries') {
      return Promise.resolve(twoLocationRows);
    }
    if (url === '/store-areas') {
      return Promise.resolve([
        { id: 2, name: 'Front Counter' },
        { id: 3, name: 'Aisle 1' },
      ]);
    }
    return Promise.resolve([]);
  });
}

describe('ExpiryEntriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads all active entries from the expiry-entries endpoint', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.TEAM_MEMBER} />);

    expect(
      await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 }),
    ).toBeInTheDocument();

    const getMock = apiService.get as unknown as jest.Mock;
    expect(getMock.mock.calls.some((call) => call[0] === '/reports/expiry-entries')).toBe(true);
    // Includes the far-future entry that the 90-day worklist would exclude.
    expect(screen.getAllByText('Aisle One Product').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('table', { name: /Printable expiry entries table/i, hidden: true }),
    ).toBeInTheDocument();
  });

  it('lets any signed-in user edit but hides delete from non-admins', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.TEAM_MEMBER} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    expect(screen.getAllByRole('button', { name: /^Edit /i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Delete /i })).not.toBeInTheDocument();
  });

  it('shows delete controls for admins', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    expect(screen.getAllByRole('button', { name: /^Edit /i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Delete /i }).length).toBeGreaterThan(0);
  });

  it('names row actions by product and keeps a single main landmark', async () => {
    mockApi();

    const { container } = render(
      <ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />,
    );

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    // The app shell owns <main>; the page must not nest another one.
    expect(container.querySelector('main')).toBeNull();
    expect(screen.getByRole('region', { name: 'All Expiry Entries' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Front Counter Product' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Aisle One Product' })).toBeInTheDocument();
    // Visible text and accessible name match (WCAG 2.5.3).
    expect(screen.getByRole('button', { name: 'Print Report' })).toBeInTheDocument();
  });

  it('moves focus into the edit row and back to Edit on cancel', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    const editButton = await screen.findByRole('button', { name: 'Edit Front Counter Product' });
    fireEvent.click(editButton);

    const dateInput = await screen.findByLabelText('Expiry date for Front Counter Product');
    await waitFor(() => expect(dateInput).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Front Counter Product' })).toHaveFocus(),
    );
  });

  it('focuses Cancel when a delete is pending and returns focus on cancel', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Aisle One Product' }));

    expect(
      screen.getByRole('button', { name: 'Confirm delete Aisle One Product' }),
    ).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.click(cancel);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Aisle One Product' })).toHaveFocus(),
    );
  });

  it('exposes a location filter control', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    expect(screen.getByRole('combobox', { name: /Filter by location/i })).toBeInTheDocument();
  });

  it('renders urgency text with AA-contrast token pairs', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    // Base amber (#D97706) is 3.2:1 on white; the muted-foreground shade passes AA.
    // The table status cell (the print table's <td> carries no colour).
    const statusCell = screen
      .getAllByText('Markdown 3')
      .find((el) => el.tagName === 'DIV' && el.className.includes('min-w-[120px]'));
    expect(statusCell?.className).toMatch(/text-semantic-warning-muted-foreground/);
    expect(statusCell?.className).not.toMatch(/text-semantic-warning(\s|$)/);
    // Mobile "Normal" badge: green-on-mint was ~2.2:1.
    const normalBadge = screen
      .getAllByText('Normal')
      .find((el) => el.className.includes('bg-semantic-success-muted'));
    expect(normalBadge?.className).toMatch(/text-semantic-success-muted-foreground/);
    // Save must not use the white-on-green success variant (2.5:1).
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit/i })[0]);
    expect(screen.getByRole('button', { name: /^Save$/i }).className).not.toMatch(
      /bg-semantic-success/,
    );
  });

  it('gives row actions and the location filter 44px touch targets', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    const edit = await screen.findByRole('button', { name: 'Edit Front Counter Product' });
    expect(edit.className).toMatch(/min-h-11/);
    expect(screen.getByRole('button', { name: 'Delete Front Counter Product' }).className).toMatch(
      /min-h-11/,
    );
    expect(screen.getByRole('combobox', { name: /Filter by location/i }).className).toMatch(
      /min-h-11/,
    );
  });

  it('tells phone users when the summary list is truncated', async () => {
    const manyRows = Array.from({ length: 51 }, (_, i) => ({
      ...twoLocationRows[0],
      inventoryId: 100 + i,
      productName: `Product ${i}`,
    }));
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) =>
      Promise.resolve(url === '/reports/expiry-entries' ? manyRows : []),
    );

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    expect(await screen.findByText(/Showing the first 50 of 51 entries/i)).toBeInTheDocument();
    const summary = screen.getByRole('list', { name: 'Expiry entry summary' });
    expect(summary.querySelectorAll(':scope > li')).toHaveLength(50);
  });

  it('prints the same derived markdown status the screen shows', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) =>
      Promise.resolve(
        url === '/reports/expiry-entries'
          ? [{ ...twoLocationRows[0], status: 'Normal', expiryDate: daysFromNow(20) }]
          : [],
      ),
    );

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    const printTable = await screen.findByRole('table', {
      name: /Printable expiry entries table/i,
      hidden: true,
    });
    const statusCell = printTable.querySelector('tbody tr td:last-child');
    expect(statusCell).toHaveTextContent('Markdown 3');
  });

  it('announces a missing token', async () => {
    render(<ExpiryEntriesPage token={null} role={ROLES.ADMIN} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });
});
