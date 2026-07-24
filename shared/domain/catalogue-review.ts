// Shared catalogue review query/response types.
//
// These types are the single source of truth for the brand-review / catalogue
// review surface across backend, workers, and frontend. Previously each package
// declared its own copy with subtle drift (e.g. `source: string` vs a typed
// union); this module consolidates them so all three packages share one shape.
//
// See OpenSpec change `enhance-supplier-policy-capture` task 11.6.

export type { CatalogueReviewState } from './brand-supplier';
export { isCatalogueReviewState, CATALOGUE_REVIEW_STATES } from './brand-supplier';
import type { BrandSource } from './brand-supplier';

// --- Title filter / sort enums --------------------------------------------

export type CatalogueTitleMatch = 'contains' | 'startsWith';
export type CatalogueTitleSort = 'titleAsc' | 'titleDesc';

// --- Brand -----------------------------------------------------------------

/**
 * A brand record as returned by the catalogue/brand-review endpoints.
 *
 * `supplier` and `productCount` are optional because some endpoints populate
 * them (e.g. `listBrands` includes `productCount`) while others return only
 * the core fields (e.g. brand-review items never include them).
 *
 * `supplier` is typed generically so each package can plug in its own
 * supplier shape (the backend uses a Prisma payload, the workers use a
 * plain interface, the frontend doesn't include it on brand-review items).
 */
export interface Brand<TSupplier = unknown> {
  id: number;
  name: string;
  manufacturerName: string | null;
  suggestedSupplierName: string | null;
  supplierId: number | null;
  source: BrandSource;
  supplier?: TSupplier | null;
  productCount?: number;
}

// --- Brand review item / page ----------------------------------------------

export interface BrandReviewItem {
  productId: number;
  sku: string;
  barcode: string;
  productName: string;
  brand: Brand | null;
}

export interface BrandReviewPage {
  items: BrandReviewItem[];
  nextCursor: number | null;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
}

// --- Brand review query options --------------------------------------------

export interface BrandReviewOptions {
  state?: import('./brand-supplier').CatalogueReviewState;
  group?: string;
  cursor?: number;
  limit?: number;
  page?: number;
  pageSize?: number;
  title?: string;
  titleMatch?: CatalogueTitleMatch;
  sort?: CatalogueTitleSort;
}
