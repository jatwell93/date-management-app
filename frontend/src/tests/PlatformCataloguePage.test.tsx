import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlatformCataloguePage from '../pages/PlatformCataloguePage';
import * as service from '../services/platformCatalogueService';

vi.mock('../services/platformCatalogueService');

const provenance = {
  latest: {
    id: 3,
    version: 3,
    seededAt: '2026-07-23T01:00:00.000Z',
    sourceFileName: 'master-v3.xlsx',
    inserted: 2,
    updated: 1,
    unchanged: 90,
    retired: 4,
    reinstated: 1,
    errorCount: 0,
  },
  history: [],
};

const corrections = {
  items: [
    {
      id: 11,
      organizationId: 'org-a',
      productId: 1,
      brandId: null,
      barcode: '9300000000001',
      enteredBrandName: 'Entered A',
      chosenSupplierId: 2,
      chosenSupplier: { id: 2, name: 'Supplier A' },
      kind: 'UNMATCHED',
      status: 'PENDING',
      createdAt: '2026-07-22T01:00:00.000Z',
      organization: { id: 'org-a', name: 'Store A' },
    },
    {
      id: 12,
      organizationId: 'org-b',
      productId: 2,
      brandId: null,
      barcode: null,
      enteredBrandName: 'Entered B',
      chosenSupplierId: null,
      chosenSupplier: null,
      kind: 'BRAND_ADDED',
      status: 'PENDING',
      createdAt: '2026-07-21T01:00:00.000Z',
      organization: { id: 'org-b', name: 'Store B' },
    },
  ],
  nextCursor: null,
};

describe('PlatformCataloguePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getCatalogueProvenance).mockResolvedValue(provenance);
    vi.mocked(service.getPendingCatalogueCorrections).mockResolvedValue(corrections);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders latest provenance, retirement warning, and pending correction details', async () => {
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('master-v3.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/4 entries retired/i)).toBeInTheDocument();
    expect(screen.getByText('Store A')).toBeInTheDocument();
    expect(screen.getByText('Supplier A')).toBeInTheDocument();
    expect(screen.getByText('Entered A')).toBeInTheDocument();
  });

  it('reports partial batch failures, clears successes, and refreshes the queue', async () => {
    vi.mocked(service.reviewCatalogueCorrection)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('network'));
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    fireEvent.click(screen.getByRole('button', { name: /accept selected/i }));

    await waitFor(() => expect(service.reviewCatalogueCorrection).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 correction failed');
    expect(service.getPendingCatalogueCorrections).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('checkbox', { name: /select correction 11/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /select correction 12/i })).toBeChecked();
  });
});
