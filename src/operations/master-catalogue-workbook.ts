/**
 * Reads the master-catalogue workbook (`.xlsx`) into plain rows for
 * `normalizeMasterCatalogueRows`.
 *
 * Kept apart from the seeding logic so that logic stays testable on literal
 * rows, and so the workbook dependency has exactly one importer. The Express
 * seeder read workbooks through the unmaintained npm build of `xlsx`; this
 * uses `exceljs`.
 *
 * Only the first worksheet is read, and its first row is the header, matching
 * the supplier price file this is fed (`supplier-doc-examples/`).
 */
import ExcelJS from 'exceljs';

import {
  normalizeMasterCatalogueRows,
  type MasterCatalogueParseResult,
} from './master-catalogue-seed';

/**
 * Collapses an exceljs cell value to the primitive a person sees in the cell.
 * A formula yields its cached result, rich text and hyperlinks their text, and
 * an error cell nothing — an `#N/A` is not a barcode.
 */
export function cellPrimitive(value: ExcelJS.CellValue | undefined): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if ('error' in value) return null;
  if ('richText' in value) return value.richText.map((run) => run.text).join('');
  if ('hyperlink' in value) return cellPrimitive(value.text as ExcelJS.CellValue);
  if ('result' in value) return cellPrimitive(value.result as ExcelJS.CellValue);
  return null;
}

/** Sheet rows from row 1, each padded to the sheet's width, blank rows kept. */
export async function readFirstSheetRows(workbookPath: string): Promise<unknown[][] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const rows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: unknown[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      values.push(cellPrimitive(row.getCell(column).value));
    }
    rows.push(values);
  }
  return rows;
}

export async function parseMasterCatalogueWorkbook(
  workbookPath: string,
): Promise<MasterCatalogueParseResult> {
  const rows = await readFirstSheetRows(workbookPath);
  if (rows === null) {
    return { entries: [], skipped: 0, errors: [{ row: 1, message: 'Workbook has no sheets' }] };
  }
  return normalizeMasterCatalogueRows(rows);
}
