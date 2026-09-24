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
 * A complete numeric literal, optionally signed, with no exponent and no
 * leading/trailing space. Deliberately stricter than `Number()`, which accepts
 * `0x10`, `1e5`, `Infinity`, surrounding whitespace and the empty string --
 * none of which is a shape worth exempting, and whitespace in particular would
 * let ` -1+1` through as " a number".
 */
const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/;

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

  // A complete numeric literal is exempt, and this is a correctness fix rather
  // than a loosening of the control. `-` is a formula prefix, so without this a
  // cost price of -5.99 exports as the text `'-5.99` -- the apostrophe is
  // retained on import by most spreadsheets, so a backup taken with this export
  // no longer round-trips as a number. Express never hit it (`escapeCSVValue`
  // did RFC 4180 quoting only), so this would have been a regression introduced
  // by adding the control at export.
  //
  // **Why exempting numbers cannot reopen the hole.** The attack needs the cell
  // to evaluate to something other than itself, which takes an operator, a call,
  // or a reference: `-1+cmd|'/c calc'!A1`, `-2+3`, `-A1`. None of those match a
  // numeric literal. `-5.99` evaluates to -5.99 whether the spreadsheet treats
  // it as text or as a formula, so there is nothing to neutralize.
  //
  // Both the typed and the stringified form are exempted. The typed one is the
  // ordinary case; the string one matters because a Postgres driver may hand
  // back a NUMERIC column as a string, and a value's safety should not depend
  // on which side of that coercion the caller happens to be on. Non-finite
  // numbers deliberately fall through: `String(-Infinity)` is `-Infinity`,
  // which is a leading `-` in front of a name, not a literal.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && NUMERIC_LITERAL.test(value)) {
    return value;
  }

  // Leading whitespace is not a defence, and this export cannot rely on its
  // caller having trimmed. The prefix list already carries `\t` and `\r` on the
  // stated grounds that importers discard them, so `\t=A1` arrives as `=A1`; a
  // plain leading space is the same shape, and it is not on the list. The
  // parsers reach `escapeSpreadsheetFormula` having trimmed, which is why the
  // gap never mattered before -- an export reads stored values verbatim.
  //
  // The dangerousness test runs against the leading-whitespace-stripped value
  // while the ORIGINAL is what gets written, so a value's own spacing survives
  // intact and only the decision changes.
  const raw = String(value);
  const probe = raw.replace(/^\s+/, '');
  const escaped = escapeSpreadsheetFormula(probe) === probe ? raw : "'" + raw;

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
