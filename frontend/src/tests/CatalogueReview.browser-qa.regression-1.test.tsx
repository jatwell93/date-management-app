import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupplierCreditsPage from '../pages/SupplierCreditsPage';
import * as svc from '../services/supplierCreditService';
import { ROLES } from '../constants/roles';

vi.mock('../hooks/useFreshApiToken', () => {
  const stable = vi.fn().mockResolvedValue('qa-token');
  return { useFreshApiToken: () => stable };
});

vi.mock('../services/supplierCreditService', () => ({
  getClaimablePool: vi.fn(),
  listClaims: vi.fn(),
  getRecoveryReport: vi.fn(),
  getSuppliers: vi.fn(),
  getBrandReview: vi.fn(),
  bulkLinkProducts: vi.fn(),
  addBrand: vi.fn(),
  confirmBrandSupplier: vi.fn(),
  getPolicyReview: vi.fn(),
  bulkAttachPolicy: vi.fn(),
  clearSupplierPolicy: vi.fn(),
  buildClaim: vi.fn(),
  assignProductSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  disposeClaimableWriteOff: vi.fn(),
}));

const mocked = svc as unknown as Record<string, ReturnType<typeof vi.fn>>;
const suppliers = [
  {
    id: 10,
    name: 'First Supplier',
    contactEmail: null,
    contactPhone: null,
    creditPolicyNote: '',
    policyWriteOffQty: null,
    policyCreditQty: null,
    followUpDays: 7,
    representativeName: null,
    representativeEmail: null,
    policyUpdatedAt: null,
  },
  {
    id: 20,
    name: 'Persisted Supplier',
    contactEmail: 'claims@example.test',
    contactPhone: null,
    creditPolicyNote: 'Return monthly',
    policyWriteOffQty: 2,
    policyCreditQty: 1,
    followUpDays: 7,
    representativeName: null,
    representativeEmail: null,
    policyUpdatedAt: '2026-07-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  mocked.getClaimablePool.mockResolvedValue([]);
  mocked.listClaims.mockResolvedValue([]);
  mocked.getRecoveryReport.mockResolvedValue({
    outstandingValue: 0,
    unclaimedValue: 0,
    suppliers: [],
  });
  mocked.getSuppliers.mockResolvedValue(suppliers);
  mocked.getPolicyReview.mockResolvedValue([]);
});

describe('Catalogue Review Browser QA regressions', () => {
  // Regression: ISSUE-QA-006 — persisted brand supplier displayed as the first supplier
  // Found by /qa on 2026-07-17
  // Report: Browser QA for enhance-supplier-policy-capture
  it('defaults an existing brand selector to its persisted supplier', async () => {
    mocked.getBrandReview.mockResolvedValue({
      items: [
        {
          productId: 301,
          sku: 'QA-SKU-001',
          barcode: 'QA-BAR-001',
          productName: 'QA Product',
          brand: {
            id: 41,
            name: 'QA Brand',
            manufacturerName: null,
            suggestedSupplierName: null,
            supplierId: 20,
            source: 'USER_ADDED',
          },
        },
      ],
      nextCursor: null,
    });

    render(<SupplierCreditsPage token="qa-token" effectiveUserRole={ROLES.ADMIN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Catalogue Review' }));

    expect(await screen.findByRole('combobox', { name: 'Supplier for QA Product' })).toHaveValue(
      '20',
    );
  });

  // Regression: ISSUE-QA-005 — successful bulk-link summary vanished during parent refresh
  // Found by /qa on 2026-07-17
  // Report: Browser QA for enhance-supplier-policy-capture
  it('keeps SKU matching and its summary mounted after the parent refresh completes', async () => {
    let finishSupplierRefresh!: (value: typeof suppliers) => void;
    const pendingSupplierRefresh = new Promise<typeof suppliers>((resolve) => {
      finishSupplierRefresh = resolve;
    });
    mocked.getSuppliers
      .mockResolvedValueOnce(suppliers)
      .mockReturnValueOnce(pendingSupplierRefresh);
    mocked.getBrandReview.mockResolvedValue({
      items: [
        {
          productId: 401,
          sku: 'QA-SKU-002',
          barcode: 'QA-BAR-002',
          productName: 'QA Unmatched Product',
          brand: null,
        },
      ],
      nextCursor: null,
    });
    mocked.bulkLinkProducts.mockResolvedValue({
      brandId: 77,
      linked: 1,
      alreadyLinked: 0,
      corrections: 1,
    });

    render(<SupplierCreditsPage token="qa-token" effectiveUserRole={ROLES.ADMIN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Catalogue Review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'SKU matching' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Select first 500 unmatched SKUs' }),
    );
    await userEvent.type(screen.getByLabelText('New brand name'), 'QA Bulk Brand');
    await userEvent.click(screen.getByRole('button', { name: 'Link 1 SKUs' }));

    await waitFor(() => expect(mocked.getSuppliers).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('region', { name: 'Catalogue SKU matching' })).toBeInTheDocument();
    await act(async () => finishSupplierRefresh(suppliers));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Linked 1, already linked 0, corrections 1',
      ),
    );
  });
});
