import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupplierCreditsPage from '../pages/SupplierCreditsPage';
import * as svc from '../services/supplierCreditService';
import { ApiError } from '../lib/api.service';
import { ROLES, type RoleValue } from '../constants/roles';
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
  updateSupplier: vi.fn(),
  getBrandReview: vi.fn(),
  addBrand: vi.fn(),
  confirmBrandSupplier: vi.fn(),
  disposeClaimableWriteOff: vi.fn(),
}));

const mocked = svc as unknown as Record<string, ReturnType<typeof vi.fn>>;

const supplier = {
  id: 10,
  name: 'Nature Labs',
  contactEmail: 'claims@nature.example',
  contactPhone: '02 1234 5678',
  creditPolicyNote: 'Return monthly\n- Include the invoice',
  policyWriteOffQty: 3,
  policyCreditQty: 1,
  followUpDays: 7,
  representativeName: 'Alex Store',
  representativeEmail: 'alex@nature.example',
  policyUpdatedAt: '2026-07-01T00:00:00.000Z',
};

function renderPage(role: RoleValue = ROLES.TEAM_MEMBER) {
  return render(<SupplierCreditsPage token="tkn" effectiveUserRole={role} />);
}

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
    renderPage();

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
    renderPage();
    await screen.findByText('Money on the table');

    await userEvent.click(screen.getByRole('button', { name: /Open Claims/ }));

    await waitFor(() => expect(screen.getByText('Claim #5')).toBeInTheDocument());
    expect(screen.getByText('Follow-up due')).toBeInTheDocument();
  });

  it('renders multi-underscore event labels in the claim timeline', async () => {
    renderPage();
    await screen.findByText('Money on the table');

    await userEvent.click(screen.getByRole('button', { name: /Open Claims/ }));
    await userEvent.click(screen.getByRole('button', { name: /Claim #5/ }));

    expect(await screen.findByText('FOLLOW UP SENT')).toBeInTheDocument();
  });

  it('opens the build-claim modal from a supplier group', async () => {
    renderPage();
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

    renderPage();
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

    renderPage();
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

    renderPage();
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

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm supplier' }));
    expect(await screen.findByText('Confirm brand supplier · Nature Brand')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm supplier' }));
    await waitFor(() => expect(mocked.confirmBrandSupplier).toHaveBeenCalledWith(44, 10, 'tkn'));
    expect(mocked.assignProductSupplier).not.toHaveBeenCalled();
  });
});

describe('supplier policy role plumbing', () => {
  beforeEach(() => {
    mocked.getClaimablePool.mockResolvedValue(pool);
    mocked.getSuppliers.mockResolvedValue([]);
    mocked.createSupplier.mockResolvedValue(supplier);
    mocked.updateSupplier.mockResolvedValue(supplier);
    mocked.assignProductSupplier.mockResolvedValue({ productId: 200, supplierId: supplier.id });
  });

  it('lets an admin author policy fields and preview instructions while creating a supplier', async () => {
    renderPage(ROLES.ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));
    await userEvent.type(screen.getByLabelText('Name'), 'New Supplier');
    await userEvent.type(screen.getByLabelText('Contact phone'), '03 9999 0000');
    await userEvent.type(
      screen.getByLabelText('Store instructions'),
      'Return monthly\n- Include invoice',
    );
    await userEvent.type(screen.getByLabelText('Representative name'), 'Jordan');
    await userEvent.type(screen.getByLabelText('Representative email'), 'jordan@example.com');
    await userEvent.type(screen.getByLabelText('Write off'), '3');
    await userEvent.type(screen.getByLabelText('Credit'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Preview instructions' }));

    expect(screen.getByText('Include invoice')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Supplier',
          contactPhone: '03 9999 0000',
          creditPolicyNote: 'Return monthly\n- Include invoice',
          representativeName: 'Jordan',
          representativeEmail: 'jordan@example.com',
          policyWriteOffQty: 3,
          policyCreditQty: 1,
        }),
        'tkn',
      ),
    );
  });

  it('shows existing instructions as preview-only to a non-admin', async () => {
    mocked.getSuppliers.mockResolvedValue([supplier]);
    renderPage(ROLES.TEAM_MEMBER);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));

    expect(screen.getByText('Include the invoice')).toBeInTheDocument();
    expect(screen.queryByLabelText('Store instructions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit supplier policy' })).not.toBeInTheDocument();
  });

  it('lets an admin edit the selected supplier policy before assigning it', async () => {
    mocked.getSuppliers.mockResolvedValue([supplier]);
    renderPage(ROLES.ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit supplier policy' }));
    const instructions = screen.getByLabelText('Store instructions');
    await userEvent.clear(instructions);
    await userEvent.type(instructions, 'Return weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Save and assign' }));

    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith(
        supplier.id,
        expect.objectContaining({ creditPolicyNote: 'Return weekly' }),
        'tkn',
      ),
    );
    expect(mocked.assignProductSupplier).toHaveBeenCalledWith(200, supplier.id, 'tkn');
  });

  it('mirrors policy validation inline before sending an invalid policy write', async () => {
    renderPage(ROLES.ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Invalid Supplier');
    await userEvent.type(screen.getByLabelText('Write off'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(screen.getByText('Store instructions are required')).toBeInTheDocument();
    expect(
      screen.getByText('Add a contact email, phone, or representative email'),
    ).toBeInTheDocument();
    expect(mocked.createSupplier).not.toHaveBeenCalled();
  });

  it('renders server 422 field details inline', async () => {
    mocked.createSupplier.mockRejectedValue(
      new ApiError('Policy validation failed', 422, 'POLICY_VALIDATION_FAILED', [
        { field: 'creditPolicyNote', message: 'Instructions need a returns schedule' },
      ]),
    );
    renderPage(ROLES.ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Server Checked');
    await userEvent.type(screen.getByLabelText('Contact phone'), '02 1111 2222');
    await userEvent.type(screen.getByLabelText('Store instructions'), 'Return stock');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Instructions need a returns schedule')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a 403 as a permission notice instead of an input error', async () => {
    mocked.createSupplier.mockRejectedValue(
      new ApiError('Only admins can change supplier policy', 403, 'FORBIDDEN'),
    );
    renderPage(ROLES.ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign supplier' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Role Changed');
    await userEvent.type(screen.getByLabelText('Contact phone'), '02 1111 2222');
    await userEvent.type(screen.getByLabelText('Store instructions'), 'Return stock');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You no longer have permission to change supplier policy',
    );
    expect(screen.queryByText('Only admins can change supplier policy')).not.toBeInTheDocument();
  });
});
