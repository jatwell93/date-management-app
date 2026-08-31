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
