import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getAllByRole('button', { name: /^Edit$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
  });

  it('shows delete controls for admins', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    expect(screen.getAllByRole('button', { name: /^Edit$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Delete$/i }).length).toBeGreaterThan(0);
  });

  it('exposes a location filter control', async () => {
    mockApi();

    render(<ExpiryEntriesPage token="test-session-value" role={ROLES.ADMIN} />);

    await screen.findByRole('heading', { name: /All Expiry Entries/i, level: 1 });

    expect(screen.getByRole('combobox', { name: /Filter by location/i })).toBeInTheDocument();
  });

  it('announces a missing token', async () => {
    render(<ExpiryEntriesPage token={null} role={ROLES.ADMIN} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });
});
