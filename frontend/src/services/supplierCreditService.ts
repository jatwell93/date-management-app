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
} from '../types/supplierCredit';

const BASE = '/supplier-credits';

export const getSuppliers = (token: string | null) =>
  apiService.get<Supplier[]>(`${BASE}/suppliers`, token ?? undefined);

export const createSupplier = (input: SupplierInput, token: string | null) =>
  apiService.post<Supplier>(`${BASE}/suppliers`, input, token ?? undefined);

export const updateSupplier = (id: number, input: SupplierInput, token: string | null) =>
  apiService.put<Supplier>(`${BASE}/suppliers/${id}`, input, token ?? undefined);

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
