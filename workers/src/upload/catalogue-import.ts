import type { ValidatedCatalogueRow } from './catalogue-parser';

const DEFAULT_IMPORT_BATCH_SIZE = 1000;
const MAX_IMPORT_BATCH_BYTES = 2 * 1024 * 1024;

export function isCatalogueWithinLimit(projectedSkuCount: number, maxSkus: number): boolean {
  return projectedSkuCount <= maxSkus;
}

export function takeImportBatch(
  rows: ValidatedCatalogueRow[],
  offset: number,
  end: number,
): ValidatedCatalogueRow[] {
  let size = Math.min(DEFAULT_IMPORT_BATCH_SIZE, end - offset);
  while (size > 1) {
    const candidate = rows.slice(offset, offset + size);
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength < MAX_IMPORT_BATCH_BYTES) {
      return candidate;
    }
    size = Math.max(1, Math.floor(size / 2));
  }
  return rows.slice(offset, offset + 1);
}
