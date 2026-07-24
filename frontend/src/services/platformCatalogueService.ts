import { apiService } from '../lib/api.service';
import type {
  CatalogueProvenanceResponse,
  PlatformCatalogueCorrectionPage,
} from '../types/platformCatalogue';

export const getCatalogueProvenance = (token: string | null) =>
  apiService.get<CatalogueProvenanceResponse>('/platform/catalogue/provenance', token ?? undefined);

export const getPendingCatalogueCorrections = (token: string | null) =>
  apiService.get<PlatformCatalogueCorrectionPage>(
    '/platform/catalogue-corrections?status=PENDING',
    token ?? undefined,
  );

export const reviewCatalogueCorrection = (
  id: number,
  status: 'ACCEPTED' | 'REJECTED',
  token: string | null,
) => apiService.patch(`/platform/catalogue-corrections/${id}`, { status }, token ?? undefined);
