// Service functions for the Supplier Credits workspace. Uses the shared apiService
// (Bearer auth, /api prefix handling, 401 handling) like the other feature services.

import { apiService, buildApiUrl } from '../lib/api.service';
import type {
  Supplier,
  SupplierInput,
  ClaimablePoolGroup,
  CreditClaim,
  CreditClaimPhoto,
  BuildClaimLineInput,
  ClaimOutcome,
  RecoveryReport,
  Brand,
  BrandReviewPage,
  CatalogueReviewState,
  CatalogueTitleMatch,
  CatalogueTitleSort,
  BulkAttachPolicyResult,
  BulkLinkProductsInput,
  BulkLinkProductsResult,
  PolicyReviewItem,
  PolicyStatus,
} from '../types/supplierCredit';

const BASE = '/supplier-credits';

export const getSuppliers = (token: string | null) =>
  apiService.get<Supplier[]>(`${BASE}/suppliers`, token ?? undefined);

export const createSupplier = (input: SupplierInput, token: string | null) =>
  apiService.post<Supplier>(`${BASE}/suppliers`, input, token ?? undefined);

export const updateSupplier = (id: number, input: Partial<SupplierInput>, token: string | null) =>
  apiService.patch<Supplier>(`${BASE}/suppliers/${id}`, input, token ?? undefined);

export const replaceSupplier = (id: number, input: SupplierInput, token: string | null) =>
  apiService.put<Supplier>(`${BASE}/suppliers/${id}`, input, token ?? undefined);

export const clearSupplierPolicy = (id: number, token: string | null) =>
  apiService.delete<Supplier>(`${BASE}/suppliers/${id}/policy`, token ?? undefined);

export const getPolicyReview = (
  token: string | null,
  options: { brand?: string; supplier?: string; status?: PolicyStatus } = {},
) => {
  const query = new URLSearchParams();
  if (options.brand) query.set('brand', options.brand);
  if (options.supplier) query.set('supplier', options.supplier);
  if (options.status) query.set('status', options.status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiService.get<PolicyReviewItem[]>(`${BASE}/policy-review${suffix}`, token ?? undefined);
};

export const bulkAttachPolicy = (
  input: { supplierId: number; brandIds: number[] },
  token: string | null,
) =>
  apiService.post<BulkAttachPolicyResult>(
    `${BASE}/policy-review/bulk-attach`,
    input,
    token ?? undefined,
  );

export const bulkLinkProducts = (input: BulkLinkProductsInput, token: string | null) =>
  apiService.post<BulkLinkProductsResult>(`${BASE}/brands/bulk-link`, input, token ?? undefined);

export const assignProductSupplier = (
  productId: number,
  supplierId: number | null,
  token: string | null,
) =>
  apiService.put<{ productId: number; supplierId: number | null }>(
    `${BASE}/products/${productId}/supplier`,
    { supplierId },
    token ?? undefined,
  );

export const getBrandReview = (
  token: string | null,
  options: {
    state?: CatalogueReviewState;
    group?: string;
    cursor?: number;
    limit?: number;
    page?: number;
    pageSize?: number;
    title?: string;
    titleMatch?: CatalogueTitleMatch;
    sort?: CatalogueTitleSort;
  } = {},
) => {
  const query = new URLSearchParams();
  if (options.state) query.set('state', options.state);
  if (options.group) query.set('group', options.group);
  const usesNumberedPagination = options.page != null || options.pageSize != null;
  if (usesNumberedPagination) {
    if (options.page != null) query.set('page', String(options.page));
    if (options.pageSize != null) query.set('pageSize', String(options.pageSize));
    if (options.title) query.set('title', options.title);
    if (options.titleMatch) query.set('titleMatch', options.titleMatch);
    if (options.sort) query.set('sort', options.sort);
  } else {
    if (options.cursor != null) query.set('cursor', String(options.cursor));
    query.set('limit', String(options.limit ?? 50));
  }
  return apiService.get<BrandReviewPage>(
    `${BASE}/brand-review?${query.toString()}`,
    token ?? undefined,
  );
};

export const addBrand = (
  input: { productId: number; name: string; supplierId?: number | null },
  token: string | null,
) => apiService.post<Brand>(`${BASE}/brands`, input, token ?? undefined);

export const confirmBrandSupplier = (brandId: number, supplierId: number, token: string | null) =>
  apiService.put<Brand>(`${BASE}/brands/${brandId}/supplier`, { supplierId }, token ?? undefined);

export const disposeClaimableWriteOff = (transactionId: number, token: string | null) =>
  apiService.post<{ status: string }>(
    `${BASE}/claimable-pool/${transactionId}/dispose`,
    {},
    token ?? undefined,
  );

export const getClaimablePool = (token: string | null, signal?: AbortSignal) =>
  apiService.get<ClaimablePoolGroup[]>(`${BASE}/claimable-pool`, token ?? undefined, signal);

export const getRecoveryReport = (token: string | null, signal?: AbortSignal) =>
  apiService.get<RecoveryReport>(`${BASE}/recovery-report`, token ?? undefined, signal);

export const listClaims = (
  view: 'open' | 'settled' | 'all',
  token: string | null,
  signal?: AbortSignal,
) => {
  const query = view === 'all' ? '' : `?view=${view}`;
  return apiService.get<CreditClaim[]>(`${BASE}/claims${query}`, token ?? undefined, signal);
};

export const getClaim = (id: number, token: string | null) =>
  apiService.get<CreditClaim>(`${BASE}/claims/${id}`, token ?? undefined);

export const buildClaim = (
  supplierId: number,
  lines: BuildClaimLineInput[],
  token: string | null,
) => apiService.post<CreditClaim>(`${BASE}/claims`, { supplierId, lines }, token ?? undefined);

export const sendClaim = (id: number, token: string | null) =>
  apiService.post<CreditClaim>(`${BASE}/claims/${id}/send`, {}, token ?? undefined);

export const sendFollowUp = (id: number, token: string | null) =>
  apiService.post<CreditClaim>(`${BASE}/claims/${id}/follow-up`, {}, token ?? undefined);

export const recordOutcome = (
  id: number,
  outcome: ClaimOutcome,
  creditedValue: number | null,
  note: string | null,
  token: string | null,
) =>
  apiService.post<CreditClaim>(
    `${BASE}/claims/${id}/outcome`,
    { outcome, creditedValue, note },
    token ?? undefined,
  );

/**
 * Photo upload is multipart, so it bypasses the JSON apiService and posts a
 * FormData body directly (Content-Type is set by the browser with the boundary).
 */
export const uploadClaimPhoto = async (
  claimId: number,
  lineId: number,
  file: File,
  token: string | null,
): Promise<CreditClaimPhoto> => {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(buildApiUrl(`${BASE}/claims/${claimId}/lines/${lineId}/photos`), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload photo: ${response.status}`);
  }
  return response.json();
};
