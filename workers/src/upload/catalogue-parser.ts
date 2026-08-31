import { escapeSpreadsheetFormula } from '../../../shared/domain/csv-injection';

export type ProductCatalogRow = {
  sku: string;
  name: string;
  barcode: string;
  costPrice: number;
  retailPrice: number | null;
};

export type ValidatedCatalogueRow = ProductCatalogRow & { rowNumber: number };

export const PRODUCT_CATALOG_HEADER_ALIASES = {
  sku: ['sku', 'itemcode', 'reordernumber', 'productcode', 'itemnumber'],
  name: ['name', 'itemdescription', 'productname', 'description', 'itemname'],
  cost: [
    'cost',
    'costprice',
    'unitcost',
    'costex',
    'price',
    'unitprice',
    'costinc',
    'itemcost',
  ],
  // Retail/selling price, captured distinct from cost so a markdown band can be
  // taken off retail (issue #338). Optional — cost-only catalogues stay valid.
  retail: ['retailprice', 'sellingprice', 'sellprice', 'rrp', 'saleprice'],
  barcode: ['barcode', 'alias', 'ean', 'upc', 'gtin', 'productbarcode', 'barcodenumber'],
} as const;

export function validateCatalogueRecords(records: string[][]): {
  rows: ValidatedCatalogueRow[];
  rowErrors: string[];
  fatalErrors: string[];
  totalRows: number;
} {
  const fatalErrors: string[] = [];
  const rowErrors: string[] = [];
  if (records.length < 2) {
    return { rows: [], rowErrors, fatalErrors: ['No product rows found'], totalRows: 0 };
  }

  const headers = records[0].map(normalizeHeader);
  const indexes = {
    sku: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.sku),
    name: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.name),
    barcode: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.barcode),
    cost: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.cost),
  };
  // Retail is optional, so it is resolved separately and excluded from the
  // required-column check below (-1 simply means "no retail column").
  const retailIndex = findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.retail);
  const missing = Object.entries(indexes)
    .filter(([, value]) => value < 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    return {
      rows: [],
      rowErrors,
      fatalErrors: [`Missing required column header(s): ${missing.join(', ')}`],
      totalRows: 0,
    };
  }

  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  const parsed: ValidatedCatalogueRow[] = [];
  let totalRows = 0;
  records.slice(1).forEach((record, index) => {
    if (!record.some((cell) => cell.trim())) return;
    totalRows += 1;
    const rowNumber = index + 2;
    const row = parseProductCatalogRow(record, { ...indexes, retail: retailIndex });
    if (!row) {
      rowErrors.push(`Row ${rowNumber}: Missing or malformed required product fields`);
      return;
    }
    if (seenSkus.has(row.sku) || seenBarcodes.has(row.barcode)) {
      rowErrors.push(`Row ${rowNumber}: Duplicate SKU or barcode in upload`);
      return;
    }
    seenSkus.add(row.sku);
    seenBarcodes.add(row.barcode);
    parsed.push({ ...row, rowNumber });
  });

  return { rows: parsed, rowErrors, fatalErrors, totalRows };
}

export function parseProductCatalogRow(
  row: string[],
  columnIndexes: { sku: number; name: number; barcode: number; cost: number; retail?: number },
): ProductCatalogRow | null {
  // Escaped after trimming, exactly as Express does (#473): the trim is what
  // collapses the leading-tab and leading-CR evasions into a bare formula, so
  // escaping first would leave a tab-prefixed formula stored as a live one.
  // Cost and retail are not escaped because they never reach storage as text —
  // parseCost returns a number or the row is rejected.
  const sku = escapeSpreadsheetFormula((row[columnIndexes.sku] || '').trim());
  const name = escapeSpreadsheetFormula((row[columnIndexes.name] || '').trim());
  const barcode = escapeSpreadsheetFormula((row[columnIndexes.barcode] || '').trim());
  const costPrice = parseCost((row[columnIndexes.cost] || '').trim());

  if (!sku || !name || !barcode || costPrice === null) {
    return null;
  }

  // Retail is optional: absent column, blank cell, or unparseable value -> null.
  const retailPrice =
    columnIndexes.retail !== undefined && columnIndexes.retail >= 0
      ? parseCost((row[columnIndexes.retail] || '').trim())
      : null;

  return { sku, name, barcode, costPrice, retailPrice };
}

export function findHeaderIndex(headers: string[], acceptedNames: readonly string[]): number {
  const accepted = new Set(acceptedNames.map(normalizeHeader));
  return headers.findIndex((header) => accepted.has(header));
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCost(value: string): number | null {
  const normalized = value.replace(/[^0-9.-]/g, '');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
