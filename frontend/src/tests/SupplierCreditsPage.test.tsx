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
}));

const mocked = svc as unknown as Record<string, ReturnType<typeof vi.fn>>;

const pool = [
  {
    supplierId: 10,
    supplierName: 'Blackmores',
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
    expect(screen.getByRole('button', { name: 'Build claim' })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('button', { name: 'Build claim' }));

    expect(await screen.findByText(/New claim · Blackmores/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Batch number')).toBeInTheDocument();
  });
});
