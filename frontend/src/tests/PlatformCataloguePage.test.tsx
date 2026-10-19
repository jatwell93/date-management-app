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
    expect(screen.getByRole('status')).toHaveTextContent('1 correction accepted.');
  });

  it('names row actions with the correction they act on', async () => {
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    expect(
      screen.getByRole('button', { name: 'Accept correction 11 (9300000000001)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reject correction 12 (Entered B)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select correction 12 (Entered B)' }),
    ).toBeInTheDocument();
  });

  it('announces a successful row action, keeps the page mounted, and moves focus to the heading', async () => {
    vi.mocked(service.reviewCatalogueCorrection).mockResolvedValue({} as never);
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    let finishRefresh: (value: typeof corrections) => void = () => {};
    vi.mocked(service.getPendingCatalogueCorrections).mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /accept correction 11/i }));

    // While the queue refreshes, the page stays mounted so the live region is not torn down.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 correction accepted.'),
    );
    expect(screen.queryByText(/loading platform catalogue/i)).not.toBeInTheDocument();
    expect(screen.getByText('Store A')).toBeInTheDocument();
    finishRefresh({ items: [corrections.items[1]], nextCursor: null });
    await waitFor(() => expect(screen.queryByText('Store A')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pending corrections' })).toHaveFocus();
  });

  it('shows correction kinds as words, not enum names', async () => {
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByText('Unmatched')).toBeInTheDocument();
    expect(screen.getByText('Brand added')).toBeInTheDocument();
    expect(screen.queryByText('BRAND_ADDED')).not.toBeInTheDocument();
  });

  it('labels each seed count and states when nothing was retired', async () => {
    vi.mocked(service.getCatalogueProvenance).mockResolvedValue({
      ...provenance,
      latest: { ...provenance.latest, retired: 0 },
    });
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByText('No entries retired')).toBeInTheDocument();
    expect(screen.getByText('Unchanged').nextElementSibling).toHaveTextContent('90');
    expect(screen.getByText('Reinstated').nextElementSibling).toHaveTextContent('1');
  });

  it('uses the singular for a single retired entry', async () => {
    vi.mocked(service.getCatalogueProvenance).mockResolvedValue({
      ...provenance,
      latest: { ...provenance.latest, retired: 1 },
    });
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByText('1 entry retired in this seed')).toBeInTheDocument();
  });

  it('gives every button and checkbox a 44px touch target', async () => {
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) expect(button).toHaveClass('min-h-11');
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox.closest('label')).toHaveClass('min-h-11', 'min-w-11');
    }
  });

  it('keeps focus on the row button when its action fails', async () => {
    vi.mocked(service.reviewCatalogueCorrection).mockRejectedValue(new Error('network'));
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    const accept = screen.getByRole('button', { name: /accept correction 11/i });
    accept.focus();
    fireEvent.click(accept);
    // Browsers can drop focus from a button while it is disabled; jsdom does not (and ignores
    // blur() on a disabled element), so simulate the loss by focusing a sink outside the page.
    expect(accept).toBeDisabled();
    const sink = document.createElement('button');
    document.body.append(sink);
    sink.focus();
    expect(accept).not.toHaveFocus();

    expect(await screen.findByRole('alert')).toHaveTextContent('1 correction failed');
    await waitFor(() => expect(accept).toBeEnabled());
    expect(screen.getByText('Store A')).toBeInTheDocument();
    expect(accept).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Pending corrections' })).not.toHaveFocus();
    sink.remove();
  });

  it('keeps focus on the bulk button when every selected action fails', async () => {
    vi.mocked(service.reviewCatalogueCorrection).mockRejectedValue(new Error('network'));
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    const rejectSelected = screen.getByRole('button', { name: /reject selected/i });
    rejectSelected.focus();
    fireEvent.click(rejectSelected);

    expect(await screen.findByRole('alert')).toHaveTextContent('2 corrections failed');
    await waitFor(() => expect(rejectSelected).toBeEnabled());
    expect(rejectSelected).toHaveFocus();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('marks select-all as indeterminate when only some rows are selected', async () => {
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    const selectAll = screen.getByRole<HTMLInputElement>('checkbox', { name: /select all/i });
    expect(selectAll.indeterminate).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /select correction 11/i }));
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /select correction 12/i }));
    expect(selectAll.indeterminate).toBe(false);
    expect(selectAll).toBeChecked();
  });

  it('tells the reviewer when more corrections are pending than are shown', async () => {
    vi.mocked(service.getPendingCatalogueCorrections).mockResolvedValue({
      ...corrections,
      nextCursor: 12,
    });
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByText(/showing the first 2 corrections/i)).toBeInTheDocument();
  });

  it('does not show the more-pending notice on the last page', async () => {
    render(<PlatformCataloguePage token="token" />);

    await screen.findByText('Store A');
    expect(screen.queryByText(/more are pending/i)).not.toBeInTheDocument();
  });

  it('shows a load error with the page heading and a retry that preserves the flow', async () => {
    vi.mocked(service.getCatalogueProvenance).mockRejectedValueOnce(new Error('Server down'));
    render(<PlatformCataloguePage token="token" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
    expect(
      screen.getByRole('heading', { level: 1, name: /catalogue provenance and triage/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Version 3')).toBeInTheDocument();
  });
});
