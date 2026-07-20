import type { MarkdownBasis, MarkdownMatrixConfig } from '../../../shared/domain/markdown';

/**
 * Persisted per-organization markdown matrix. The three bands map to the shared
 * day-to-expiry windows (band1 = 61-90 days, band2 = 31-60, band3 = 0-30).
 */
export interface MarkdownConfig {
  organizationId: string;
  band1Percentage: number;
  band2Percentage: number;
  band3Percentage: number;
  band1Basis: MarkdownBasis;
  band2Basis: MarkdownBasis;
  band3Basis: MarkdownBasis;
}

/** The API/UI-facing shape: the resolver-ready matrix plus whether retail is available. */
export interface MarkdownConfigResponse {
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
}
