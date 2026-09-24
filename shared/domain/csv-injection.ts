// Shared spreadsheet-formula (CSV injection) escaping. Both backends ingest the
// same operator-supplied CSVs — Express through `validateProductRowStrictly` /
// `validateExpiryRowStrictly`, the Worker through `upload/catalogue-parser.ts`
// and `upload/expiry-parser.ts` — and both must neutralize the same payloads
// with the same rule, or a value that is text in one backend is a live formula
// in the other. The rule lived only in Express until the Worker cutover dropped
// it (#473); it lives here now so the two can no longer disagree.
//
// The control is the OWASP mitigation: a cell whose first character can start a
// formula is prefixed with an apostrophe, which spreadsheets render as "treat
// the rest as text". It is applied at *ingestion*, not at export, because the
// export that weaponizes a stored payload need not live in the same service —
// a support export, an analytics pull, or any downstream consumer of the
// catalogue re-opens the hole, and none of them would think to sanitize data
// they assume was already clean. The stored value is the vulnerability; the
// export is only the trigger.

/**
 * First characters that let a spreadsheet cell start a formula.
 *
 * `\t` and `\r` are the evasion variants: a leading tab or carriage return is
 * discarded by most spreadsheet importers, so `\t=A1` evaluates as `=A1`. Both
 * call sites trim before escaping, which collapses those variants into the bare
 * `=` case — the entries stay listed so the rule is still correct if this is
 * ever applied to an untrimmed value.
 */
export const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * Prefix a dangerous cell value with a single apostrophe, once.
 *
 * Deliberately narrow: it inspects only the first character and adds at most
 * one apostrophe. Escaping every dangerous character, or escaping an already
 * escaped value, would corrupt legitimate data — `=SUM(A1)=5` must come back as
 * `'=SUM(A1)=5`, and a name like `Total: 5+3` must come back untouched, because
 * a non-leading operator cannot start a formula.
 */
export function escapeSpreadsheetFormula(value: string): string {
  for (const prefix of CSV_INJECTION_PREFIXES) {
    if (value.startsWith(prefix)) {
      return "'" + value;
    }
  }
  return value;
}

/**
 * Serialize one value as a CSV field: formula-escaped, then RFC 4180 quoted.
 *
 * **The order is the point, and it is why this lives here rather than beside a
 * generic CSV writer.** Quoting first would produce `"=SUM(A1)"`, whose first
 * character is a quote, so the formula check would no longer fire and the cell
 * would still evaluate when the file is opened. Escaping first produces
 * `'=SUM(A1)`, which then quotes only if it contains a delimiter. Two correct
 * transforms in the wrong order are a live vulnerability, so they are one
 * function and cannot be composed wrongly at a call site.
 *
 * **This escapes at export, which the note at the top of this file argues
 * against.** That argument holds where ingestion covers every write path, and
 * for the catalogue it does. It does not hold for products: `POST
 * /api/products` (`index-minimal.ts` `handleCreateProduct`) stores `name`
 * verbatim, reaching neither parser, so a manually created product carries an
 * unescaped payload to any consumer. Until that write path escapes on the way
 * in, an export whose entire purpose is to hand a customer a file and tell them
 * to open it in a spreadsheet cannot assume its inputs are clean. Escaping
 * twice is harmless -- {@link escapeSpreadsheetFormula} adds at most one
 * apostrophe and an already-escaped value starts with `'`, which is not a
 * formula prefix.
 */
export function toCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const escaped = escapeSpreadsheetFormula(String(value));

  if (/[",\n\r]/.test(escaped)) {
    return '"' + escaped.replace(/"/g, '""') + '"';
  }
  return escaped;
}

/**
 * Build a CSV document from a header row and the rows beneath it, every field
 * passed through {@link toCsvField}.
 *
 * CRLF line endings per RFC 4180: Excel on Windows treats a bare LF inside a
 * quoted field inconsistently, and a product name with an embedded newline is
 * exactly the kind of value this export carries.
 *
 * `headers` is constrained to keys of the row type so a published header list
 * cannot name a column the rows do not have. That is not hypothetical here:
 * `docs/tier-downgrade-guide.md` promised customers a `Category` column that
 * has never existed on `products` in any migration, and a header list typed as
 * `string[]` would have let it be added and emitted as a column of blanks.
 */
export function buildCsv<Row extends object>(
  headers: ReadonlyArray<keyof Row & string>,
  rows: readonly Row[],
): string {
  const lines = [
    headers.map((header) => toCsvField(header)).join(','),
    ...rows.map((row) =>
      headers
        .map((header) => toCsvField(row[header] as string | number | null | undefined))
        .join(','),
    ),
  ];
  return lines.join('\r\n');
}
