import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupplierCreditsPage from '../pages/SupplierCreditsPage';
import * as svc from '../services/supplierCreditService';
import '@testing-library/jest-dom';

// Return a STABLE callback (like the real hook) so `load`'s useCallback dep does
// not change every render and cause an effect loop.
vi.mock('../hooks/useFreshApiToken', () => {
  const stable = vi.fn().mockResolvedValue('tkn');
  return { useFreshApiToken: () => stable };
});

vi.mock('../services/supplierCreditService', () => ({
  getClaimablePool: vi.fn(),
  listClaims: vi.fn(),
  getRecoveryReport: vi.fn(),
  getSuppliers: vi.fn(),
  buildClaim: vi.fn(),
  assignProductSupplier: vi.fn(),
  createSupplier: vi.fn(),
  getBrandReview: vi.fn(),
  addBrand: vi.fn(),
  confirmBrandSupplier: vi.fn(),
  disposeClaimableWriteOff: vi.fn(),
}));

const mocked = svc as unknown as Record<string, ReturnType<typeof vi.fn>>;

const pool = [
  {
    supplierId: 10,
    supplierName: 'Blackmores',
    state: 'CLAIMABLE',
    expectedCreditValueTotal: 20,
    items: [
      {
        transactionId: 1,
        productId: 100,
        sku: 'BM-1',
        productName: 'Vitamin D',
        unitsDiscarded: 6,
        costPrice: 10,
        expectedCreditUnits: 2,
        expectedCreditValue: 20,
      },
    ],
  },
  {
    supplierId: null,
    supplierName: null,
    state: 'NEEDS_BRAND',
    expectedCreditValueTotal: 0,
    items: [
      {
        transactionId: 2,
        productId: 200,
        sku: 'X-1',
        productName: 'Mystery',
        unitsDiscarded: 2,
        costPrice: 5,
        expectedCreditUnits: null,
        expectedCreditValue: null,
      },
    ],
  },
];

const openClaim = {
  id: 5,
  supplierId: 10,
  status: 'SENT',
  contactEmailSnapshot: 'x@y.com',
  expectedCreditValue: 20,
  expectedCreditUnits: 2,
  creditedValue: null,
  sentAt: '2026-07-01T00:00:00.000Z',
  nextFollowUpAt: '2026-07-01T00:00:00.000Z', // in the past → follow-up due
  followUpCount: 0,
  settledAt: null,
  supplier: {
    id: 10,
    name: 'Blackmores',
    contactEmail: 'x@y.com',
    creditPolicyNote: '',
    policyWriteOffQty: 3,
    policyCreditQty: 1,
    followUpDays: 7,
  },
  lines: [],
  events: [{ id: 1, type: 'FOLLOW_UP_SENT', note: null, createdAt: '2026-07-01T00:00:00.000Z' }],
};

beforeEach(() => {
  mocked.getClaimablePool.mockResolvedValue(pool);
  mocked.getSuppliers.mockResolvedValue([]);
  mocked.getBrandReview.mockResolvedValue({ items: [], nextCursor: null });
  mocked.disposeClaimableWriteOff.mockResolvedValue({ status: 'DISPOSED' });
  mocked.getRecoveryReport.mockResolvedValue({
    outstandingValue: 20,
    unclaimedValue: 200,
    suppliers: [
      {
        supplierId: 10,
        supplierName: 'Blackmores',
        claimsSent: 1,
        claimsCredited: 0,
        expectedValue: 20,
        creditedValue: 0,
        recoveryRate: 0,
      },
    ],
  });
  mocked.listClaims.mockImplementation((view: string) =>
    Promise.resolve(view === 'open' ? [openClaim] : []),
  );
});

describe('SupplierCreditsPage', () => {
  it('renders the recovery panel and the claimable pool grouped by supplier', async () => {
    render(<SupplierCreditsPage token="tkn" />);

    expect(await screen.findByText('Money on the table')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    // Blackmores appears in both the recovery panel and the pool group.
    expect(screen.getAllByText('Blackmores').length).toBeGreaterThan(0);
    expect(screen.getByText('⚠ Needs supplier')).toBeInTheDocument();
    // Supplier group offers a build action; needs-supplier offers assign.
    expect(screen.getByRole('button', { name: 'Begin claim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign supplier' })).toBeInTheDocument();
  });

  it('shows the follow-up-due badge on the Open Claims tab', async () => {
    render(<SupplierCreditsPage token="tkn" />);
    await screen.findByText('Money on the table');

    await userEvent.click(screen.getByRole('button', { name: /Open Claims/ }));

    await waitFor(() => expect(screen.getByText('Claim #5')).toBeInTheDocument());
    expect(screen.getByText('Follow-up due')).toBeInTheDocument();
  });

  it('renders multi-underscore event labels in the claim timeline', async () => {
    render(<SupplierCreditsPage token="tkn" />);
    await screen.findByText('Money on the table');

    await userEvent.click(screen.getByRole('button', { name: /Open Claims/ }));
    await userEvent.click(screen.getByRole('button', { name: /Claim #5/ }));

    expect(await screen.findByText('FOLLOW UP SENT')).toBeInTheDocument();
  });

  it('opens the build-claim modal from a supplier group', async () => {
    render(<SupplierCreditsPage token="tkn" />);
    await screen.findByText('Money on the table');

    await userEvent.click(screen.getByRole('button', { name: 'Begin claim' }));

    expect(await screen.findByText(/New claim · Blackmores/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Batch number')).toBeInTheDocument();
  });

  it('reviews catalogue matches by suggested supplier with cursor pagination', async () => {
    mocked.getBrandReview
      .mockResolvedValueOnce({
        items: [
          {
            productId: 301,
            sku: 'VIT-1',
            barcode: '930000000001',
            productName: 'Vitamin One',
            brand: {
              id: 41,
              name: 'Nature Brand',
              manufacturerName: 'Nature Labs',
              suggestedSupplierName: 'Nature Labs',
              supplierId: null,
              source: 'REFERENCE',
            },
          },
        ],
        nextCursor: 301,
      })
      .mockResolvedValueOnce({
        items: [
          {
            productId: 302,
            sku: 'MISSING',
            barcode: '',
            productName: 'Needs a brand',
            brand: null,
          },
        ],
        nextCursor: null,
      });

    render(<SupplierCreditsPage token="tkn" />);
    await screen.findByText('Money on the table');
    await userEvent.click(screen.getByRole('button', { name: 'Catalogue Review' }));

    expect(await screen.findByText('Nature Labs')).toBeInTheDocument();
    expect(screen.getByText('Pending confirmation')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Needs a brand')).toBeInTheDocument();
    expect(mocked.getBrandReview).toHaveBeenLastCalledWith('tkn', {
      cursor: 301,
      limit: 50,
    });
  });

  it('does not reload catalogue review again after an inline brand add refreshes the page data', async () => {
    mocked.getBrandReview.mockResolvedValue({
      items: [
        {
          productId: 301,
          sku: 'MISSING',
          barcode: '',
          productName: 'Needs a brand',
          brand: null,
        },
      ],
      nextCursor: null,
    });
    mocked.addBrand.mockResolvedValue({
      id: 51,
      name: 'Added Brand',
      supplierId: null,
      source: 'USER_ADDED',
    });

    render(<SupplierCreditsPage token="tkn" />);
    await screen.findByText('Money on the table');
    await userEvent.click(screen.getByRole('button', { name: 'Catalogue Review' }));
    await screen.findByText('Needs a brand');

    await userEvent.type(screen.getByLabelText('Brand name for Needs a brand'), 'Added Brand');
    await userEvent.click(screen.getByRole('button', { name: 'Add brand' }));

    await waitFor(() => expect(mocked.addBrand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocked.getClaimablePool).toHaveBeenCalledTimes(2));
    expect(mocked.getBrandReview).toHaveBeenCalledTimes(2);
  });

  it('offers claim and confirmed disposal for suppliers without a policy', async () => {
    mocked.getClaimablePool.mockResolvedValue([
      {
        ...pool[0],
        state: 'NO_POLICY',
        expectedCreditValueTotal: 0,
      },
    ]);

    render(<SupplierCreditsPage token="tkn" />);
    expect(await screen.findByText('No policy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Begin claim' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dispose (auto-flagged)' }));
    expect(await screen.findByText('Dispose this write-off?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm disposal' }));
    await waitFor(() => expect(mocked.disposeClaimableWriteOff).toHaveBeenCalledWith(1, 'tkn'));
  });

  it('confirms a pending brand through the supplier workflow instead of creating a product override', async () => {
    mocked.getSuppliers.mockResolvedValue([
      {
        id: 10,
        name: 'Nature Labs',
        contactEmail: null,
        creditPolicyNote: '',
        policyWriteOffQty: null,
        policyCreditQty: null,
        followUpDays: 7,
      },
    ]);
    mocked.getClaimablePool.mockResolvedValue([
      {
        supplierId: null,
        supplierName: 'Nature Labs',
        state: 'PENDING_CONFIRMATION',
        expectedCreditValueTotal: 0,
        items: [{ ...pool[0].items[0], brandId: 44, brandName: 'Nature Brand' }],
      },
    ]);
    mocked.confirmBrandSupplier.mockResolvedValue({ id: 44, source: 'CONFIRMED' });

    render(<SupplierCreditsPage token="tkn" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm supplier' }));
    expect(await screen.findByText('Confirm brand supplier · Nature Brand')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm supplier' }));
    await waitFor(() => expect(mocked.confirmBrandSupplier).toHaveBeenCalledWith(44, 10, 'tkn'));
    expect(mocked.assignProductSupplier).not.toHaveBeenCalled();
  });
});
