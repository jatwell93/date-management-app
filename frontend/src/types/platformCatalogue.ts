export interface CatalogueSeedRun {
  id: number;
  version: number;
  seededAt: string;
  sourceFileName: string;
  inserted: number;
  updated: number;
  unchanged: number;
  retired: number;
  reinstated: number;
  errorCount: number;
}

export interface CatalogueProvenanceResponse {
  latest: CatalogueSeedRun | null;
  history: CatalogueSeedRun[];
}

export interface PlatformCatalogueCorrection {
  id: number;
  organizationId: string;
  productId: number | null;
  brandId: number | null;
  barcode: string | null;
  enteredBrandName: string | null;
  chosenSupplierId: number | null;
  chosenSupplier?: { id: number; name: string } | null;
  kind: string;
  status: string;
  createdAt: string;
  organization: { id: string; name: string };
}

export interface PlatformCatalogueCorrectionPage {
  items: PlatformCatalogueCorrection[];
  nextCursor: number | null;
}
