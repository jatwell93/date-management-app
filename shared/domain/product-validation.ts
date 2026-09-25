// Field validation for the product write paths (`POST /api/products`,
// `PUT /api/products/:id`).
//
// This is the port of Express's `productSchema` (`backend/src/schemas/index.ts`),
// applied through `validateRequest(productSchema)` on both routes. It lives in
// `shared/` for the reason `shared/domain/csv-injection.ts` gives: a rule
// enforced in one backend and not the other is a rule a caller picks the
// backend for.
//
// **What this is NOT a port of.** Express also lists
// `validateBusinessRules` (`backend/src/middleware/data-integrity.middleware.ts`)
// on both routes, and its product branch reads:
//
//     if (req.path.includes('/products') && (method === 'POST' || 'PUT')) {
//       const { cost_price } = req.body;
//
// That branch has never executed. The router is mounted at `/api/products`
// (`backend/src/index.ts:311`), and inside a mounted router `req.path` is
// stripped of the mount prefix -- a `PUT /api/products/7` arrives with
// `req.path === '/7'`, so the `includes('/products')` test is false for every
// request that reaches it. Independently, the body key is `cost_price` while
// the schema, the controller (`product.controller.ts:78`) and the frontend all
// use `costPrice`. Its unit test supplies both the path and the key that
// production never supplies, which is why it passes against a middleware that
// does nothing. So the whole of Express's product validation in practice is the
// zod schema reproduced here, and issue #530 is the accurate description of the
// gap: the Worker accepts a negative or unbounded `costPrice`, where Express
// refused it with a 400.
//
// Semantics are deliberately partial: only fields PRESENT in the input are
// checked. That matters most on update. Rows predating these rules -- CSV
// import writes products without going through this route -- may hold a barcode
// outside 8-14 characters, and a validator that refused a field the caller did
// not send would make such a row impossible to edit at all.
//
// **The identifier rules are off by default, and that is not an oversight.**
// Express's schema also constrained barcode to 8-14 alphanumeric characters,
// sku to 50, and name to 200 without angle brackets. Those are ported here but
// gated behind `strictIdentifiers`, which the Worker does not set, because
// "restore parity" is not automatically safe when the permissive side is the
// one that has been in production. Express has not served this route since
// cutover; the Worker has, without these rules. Turning them on is therefore
// not a restoration, it is a new restriction on live traffic -- and this is a
// grocery expiry app, where PLU codes on loose produce are four or five digits
// and would be refused outright by the 8-character floor. The repository's own
// fixtures agree: three of the four distinct barcodes in the Worker test suite
// are shorter than eight characters.
//
// The cost-price rules are not gated, because there is no legitimate negative
// cost price and the harm is not hypothetical -- see `validateCostPrice`.
// Enabling `strictIdentifiers` needs a census of live `products.barcode` values
// first, which is a production query, not a code decision.

export class ProductValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductValidationError';
  }
}

/** Express: `.regex(/^[a-zA-Z0-9-]+$/)` on both barcode and sku. */
const ALPHANUMERIC_WITH_HYPHENS = /^[a-zA-Z0-9-]+$/;

/**
 * Express: `.regex(/^\d+(\.\d{1,2})?$/)` on the string branch of costPrice.
 *
 * Note this accepts no sign, so a string `'-1'` is refused by the format check
 * before any range check sees it. The numeric branch has no such shortcut,
 * which is why the range check below is not redundant with it.
 */
const DECIMAL_STRING = /^\d+(\.\d{1,2})?$/;

export const MAX_COST_PRICE = 10000;
const MAX_BARCODE_LENGTH = 14;
const MIN_BARCODE_LENGTH = 8;
const MAX_SKU_LENGTH = 50;
const MAX_NAME_LENGTH = 200;

export interface ProductWriteInput {
  barcode?: unknown;
  sku?: unknown;
  name?: unknown;
  costPrice?: unknown;
  notes?: unknown;
}

export interface ProductWriteOptions {
  /**
   * Enable Express's barcode/sku/name length and character rules. Off by
   * default; see the note at the top of this file for why enabling it on the
   * Worker needs a census of live barcodes first.
   */
  strictIdentifiers?: boolean;
}

export interface ValidatedProductWrite {
  barcode?: string;
  sku?: string | null;
  name?: string;
  costPrice?: number;
  notes?: string;
}

// The three identifier validators below are each split in two, because the
// file's central distinction is exactly that split: rules that hold of every
// product regardless of mode, and Express's shape rules, which are optional
// because the Worker has been serving these routes without them since cutover.
// Keeping the second kind in its own function means the always-on rules are
// readable without scrolling past constraints that usually do not apply.

/** Express's barcode shape rules. Only reached when `strictIdentifiers` is on. */
function assertExpressBarcodeShape(value: string): void {
  if (value.length < MIN_BARCODE_LENGTH) {
    throw new ProductValidationError(`Barcode must be at least ${MIN_BARCODE_LENGTH} characters`);
  }
  if (value.length > MAX_BARCODE_LENGTH) {
    throw new ProductValidationError(`Barcode must be at most ${MAX_BARCODE_LENGTH} characters`);
  }
  if (!ALPHANUMERIC_WITH_HYPHENS.test(value)) {
    throw new ProductValidationError('Barcode must be alphanumeric with optional hyphens');
  }
}

function validateBarcode(value: unknown, strict: boolean): string {
  if (typeof value !== 'string') {
    throw new ProductValidationError('Barcode must be a string');
  }
  // Refused regardless of `strict`. The permissive mode exists so that short
  // legacy codes stay editable, and '' is not a short code -- it is the absence
  // of one. Create already refuses it (`requiredString` in `index-minimal.ts`),
  // so without this the update path could put a row into a state the create
  // path cannot produce: a product with no scan key, invisible to every
  // by-barcode lookup in the app. Only fields actually present are checked, so
  // this still leaves a legacy four-digit barcode fully editable.
  if (value.length === 0) {
    throw new ProductValidationError('Barcode cannot be empty');
  }
  if (strict) {
    assertExpressBarcodeShape(value);
  }
  return value;
}

/** Express's sku shape rules. Only reached when `strictIdentifiers` is on. */
function assertExpressSkuShape(value: string): void {
  if (value.length > MAX_SKU_LENGTH) {
    throw new ProductValidationError(`SKU must be at most ${MAX_SKU_LENGTH} characters`);
  }
  if (!ALPHANUMERIC_WITH_HYPHENS.test(value)) {
    throw new ProductValidationError('SKU must be alphanumeric with optional hyphens');
  }
}

function validateSku(value: unknown, strict: boolean): string {
  if (typeof value !== 'string') {
    throw new ProductValidationError('SKU must be a string');
  }
  // Deliberately NOT given the empty-string guard that barcode and name carry.
  // That guard is safe there because it only makes update agree with a rule
  // create already enforces. Here there is no such rule to agree with: create
  // derives the column as `${data.sku ?? data.barcode}` (`database.ts`), and
  // '' is not nullish, so a create with `sku: ''` stores '' and has done since
  // cutover. Refusing it here would be a new restriction on live traffic, not
  // a restored one -- the same trap the header describes for the 8-character
  // barcode floor. Closing it needs a census of live `products.sku` first.
  if (strict) {
    assertExpressSkuShape(value);
  }
  return value;
}

/** Express's name shape rules. Only reached when `strictIdentifiers` is on. */
function assertExpressNameShape(value: string): void {
  if (value.length > MAX_NAME_LENGTH) {
    throw new ProductValidationError(`Product name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  // Express's `.refine(val => !val.includes('<') && !val.includes('>'))`.
  if (value.includes('<') || value.includes('>')) {
    throw new ProductValidationError('Product name cannot contain HTML tags');
  }
}

function validateName(value: unknown, strict: boolean): string {
  if (typeof value !== 'string') {
    throw new ProductValidationError('Product name must be a string');
  }
  // As with barcode: create refuses '' via `requiredString`, so allowing it on
  // update would let the update path produce a nameless row that create cannot.
  if (value.length === 0) {
    throw new ProductValidationError('Product name cannot be empty');
  }
  if (strict) {
    assertExpressNameShape(value);
  }
  return value;
}

/**
 * "What number is this?", separated from "is that number allowed?".
 *
 * Express's schema expressed the same split as two zod branches -- a numeric
 * one and a string one carrying `.transform(parseFloat)` -- and keeping them
 * apart here means the range rules below are stated once rather than once per
 * input type.
 */
function coerceCostPrice(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new ProductValidationError('Cost price must be a number');
  }
  if (!DECIMAL_STRING.test(value)) {
    throw new ProductValidationError('Cost price must be a valid number');
  }
  return parseFloat(value);
}

/**
 * The control issue #530 names.
 *
 * A negative cost price is not merely bad data: `cost_price` is summed as a
 * signed value by the loss reports, so one negative row silently offsets real
 * losses elsewhere in the same total. That is why this is refused at the write
 * rather than clamped at the read.
 *
 * Returns the coerced number, because Express's schema coerces the string
 * branch with `.transform(parseFloat)` and the handler downstream expects a
 * number.
 */
export function validateCostPrice(value: unknown): number {
  const coerced = coerceCostPrice(value);

  // Rejects NaN and both infinities. `NaN < 0` and `NaN > MAX` are both false,
  // so the two range checks below would each pass it through -- a hole worth
  // closing explicitly rather than relying on the comparisons.
  if (!Number.isFinite(coerced)) {
    throw new ProductValidationError('Cost price must be a valid number');
  }
  if (coerced < 0) {
    throw new ProductValidationError('Cost price must be a non-negative number');
  }
  if (coerced > MAX_COST_PRICE) {
    throw new ProductValidationError('Cost price seems unusually high. Please verify.');
  }

  return coerced;
}

/**
 * Validate the fields present on a product create or update body.
 *
 * Absent fields are not checked and not returned; `undefined` and a missing key
 * are treated identically, matching zod's `.optional()`. `sku: null` is
 * accepted and passed through, because the Worker's create path already treats
 * null as "derive the SKU from the barcode".
 *
 * Unknown keys are ignored rather than rejected, as zod's default
 * (non-`.strict()`) object does.
 */
export function validateProductWrite(
  input: ProductWriteInput,
  options: ProductWriteOptions = {},
): ValidatedProductWrite {
  const strict = options.strictIdentifiers === true;
  const validated: ValidatedProductWrite = {};

  if (input.barcode !== undefined) {
    validated.barcode = validateBarcode(input.barcode, strict);
  }
  if (input.sku !== undefined) {
    validated.sku = input.sku === null ? null : validateSku(input.sku, strict);
  }
  if (input.name !== undefined) {
    validated.name = validateName(input.name, strict);
  }
  if (input.costPrice !== undefined) {
    validated.costPrice = validateCostPrice(input.costPrice);
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') {
      throw new ProductValidationError('Notes must be a string');
    }
    validated.notes = input.notes;
  }

  return validated;
}
