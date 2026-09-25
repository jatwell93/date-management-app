/**
 * Unit coverage for `shared/domain/product-validation.ts`, the port of
 * Express's `productSchema` onto the Worker's two product write paths
 * (task 3.1.q, closing issue #530).
 *
 * The cost-price rules carry the weight here. `cost_price` reaches the loss and
 * markdown reports as a signed `SUM`, so one negative row does not merely look
 * wrong on its own record -- it cancels real losses out of a total the customer
 * reads as authoritative. The bounds are refused at the write for that reason.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_COST_PRICE,
  ProductValidationError,
  validateCostPrice,
  validateProductWrite,
} from '../../shared/domain/product-validation';

describe('validateCostPrice', () => {
  it('accepts the boundary values', () => {
    expect(validateCostPrice(0)).toBe(0);
    expect(validateCostPrice(MAX_COST_PRICE)).toBe(MAX_COST_PRICE);
    expect(validateCostPrice(12.34)).toBe(12.34);
  });

  it('refuses a negative cost price', () => {
    // Issue #530. This is the one that corrupts a report rather than a row.
    expect(() => validateCostPrice(-0.01)).toThrow(ProductValidationError);
    expect(() => validateCostPrice(-9999)).toThrow(ProductValidationError);
  });

  it('refuses a cost price above the ceiling', () => {
    expect(() => validateCostPrice(MAX_COST_PRICE + 0.01)).toThrow(ProductValidationError);
  });

  it('coerces the string form the way Express did', () => {
    // Express's schema had a string branch with `.transform(parseFloat)`, and
    // the Worker's create handler previously did
    // `typeof costPrice === 'number' ? costPrice : 0` -- so a client sending
    // '12.50' created a product costing zero, silently.
    expect(validateCostPrice('12.50')).toBe(12.5);
    expect(validateCostPrice('0')).toBe(0);
    expect(validateCostPrice('7')).toBe(7);
  });

  it('refuses string forms outside the accepted grammar', () => {
    // `-1` has no sign in the grammar, `1.234` more decimals than money has,
    // and the rest are not numbers at all. Each must throw rather than coerce
    // to NaN and slip through a range check.
    for (const bad of ['-1', '1.234', 'abc', '', '1e3', ' 1', '1 ', '0x10', '.5']) {
      expect(() => validateCostPrice(bad), bad).toThrow(ProductValidationError);
    }
  });

  it('refuses NaN and both infinities', () => {
    // **Not redundant with the range checks.** `NaN < 0` and `NaN > 10000` are
    // both false, so NaN passes every comparison and would reach the database
    // without the explicit finite check. Infinity fails the ceiling check but
    // -Infinity is caught only by the negative check, and relying on that
    // ordering is fragile.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => validateCostPrice(bad), String(bad)).toThrow(ProductValidationError);
    }
  });

  it('refuses non-numeric types', () => {
    for (const bad of [null, true, false, {}, [], [5]]) {
      expect(() => validateCostPrice(bad), JSON.stringify(bad)).toThrow(ProductValidationError);
    }
  });
});

describe('validateProductWrite', () => {
  it('checks only the fields that are present', () => {
    // Partial semantics are what makes the update path usable against rows that
    // predate these rules -- a CSV import can have written a barcode outside
    // 8-14 characters, and re-validating a field the caller never sent would
    // make such a product impossible to rename.
    expect(validateProductWrite({})).toEqual({});
    expect(validateProductWrite({ name: 'Just the name' })).toEqual({ name: 'Just the name' });
  });

  it('treats an explicit undefined as absent, the way zod .optional() does', () => {
    expect(validateProductWrite({ costPrice: undefined, barcode: undefined })).toEqual({});
  });

  it('ignores unknown keys rather than rejecting them', () => {
    // zod objects are non-strict by default; Express accepted and dropped these.
    expect(validateProductWrite({ name: 'Keep', retailPrice: 9, id: 4 } as never)).toEqual({
      name: 'Keep',
    });
  });

  describe('identifiers, with strictIdentifiers OFF (what the Worker uses)', () => {
    it('type-checks barcode, sku and name but does not constrain their shape', () => {
      // **The default deliberately does NOT enforce Express's rules.** A
      // four-digit PLU code on loose produce is a legitimate barcode in a
      // grocery app and would be refused by the 8-character floor, and the
      // Worker -- not Express -- is what has served these routes since cutover.
      // See the note at the top of the module.
      expect(validateProductWrite({ barcode: '4011' }).barcode).toBe('4011');
      expect(validateProductWrite({ name: 'Juice <1L' }).name).toBe('Juice <1L');
      expect(validateProductWrite({ sku: 'has space' }).sku).toBe('has space');
      expect(validateProductWrite({ name: 'N'.repeat(500) }).name).toHaveLength(500);
    });

    it('still refuses a non-string where a string is required', () => {
      expect(() => validateProductWrite({ barcode: 12345678 })).toThrow(ProductValidationError);
      expect(() => validateProductWrite({ name: { toString: () => 'x' } })).toThrow(
        ProductValidationError,
      );
      expect(() => validateProductWrite({ notes: 5 })).toThrow(ProductValidationError);
    });

    it('passes a null sku through', () => {
      // null means "derive from the barcode" on create; the caller decides
      // whether that is meaningful, so the validator passes it rather than
      // refusing it here.
      expect(validateProductWrite({ sku: null }).sku).toBeNull();
    });

    it('refuses an empty barcode and an empty name even though it is permissive', () => {
      // The permissive mode exists for short legacy codes, not for absent ones.
      // Create refuses '' via `requiredString`, so allowing it here would let
      // `PUT /api/products/:id` produce a row -- no scan key, or no name --
      // that `POST /api/products` cannot.
      expect(() => validateProductWrite({ barcode: '' })).toThrow(/Barcode cannot be empty/);
      expect(() => validateProductWrite({ name: '' })).toThrow(/Product name cannot be empty/);
      // One character is not empty, and stays accepted: the guard is about
      // absence, not about length.
      expect(validateProductWrite({ barcode: '4' }).barcode).toBe('4');
    });

    it('still accepts an empty sku, because create already stores one', () => {
      // NOT an oversight, and deliberately unlike barcode/name above.
      // `createProduct` writes `${data.sku ?? data.barcode}` and '' is not
      // nullish, so a create with `sku: ''` has stored '' since cutover.
      // Refusing it here would be a new restriction on live traffic rather
      // than a restored one. If this test ever starts failing because the
      // guard was added, the census of live `products.sku` is the prerequisite,
      // not a test edit.
      expect(validateProductWrite({ sku: '' }).sku).toBe('');
    });
  });

  describe('identifiers, with strictIdentifiers ON (Express parity)', () => {
    const strict = { strictIdentifiers: true };

    it('accepts the EAN/UPC range', () => {
      expect(validateProductWrite({ barcode: '12345678' }, strict).barcode).toBe('12345678');
      expect(validateProductWrite({ barcode: '12345678901234' }, strict).barcode).toBe(
        '12345678901234',
      );
      expect(validateProductWrite({ barcode: 'ABC-123-XYZ' }, strict).barcode).toBe('ABC-123-XYZ');
    });

    it('refuses barcode lengths outside 8-14 and non-alphanumeric characters', () => {
      for (const bad of ['1234567', '123456789012345', 'ABC 123456', 'ABC_123456', '12345678!']) {
        expect(() => validateProductWrite({ barcode: bad }, strict), bad).toThrow(
          ProductValidationError,
        );
      }
    });

    it('refuses an empty name, which the length and angle-bracket rules let through', () => {
      // Express's schema constrained the name to <=200 characters with no
      // angle brackets, and '' satisfies both -- so strict mode accepted a
      // nameless product until the unconditional guard was added. The guard
      // is not Express parity; it is stricter than Express, on purpose.
      expect(() => validateProductWrite({ name: '' }, strict)).toThrow(
        /Product name cannot be empty/,
      );
    });

    it('refuses over-long or non-alphanumeric skus', () => {
      expect(validateProductWrite({ sku: 'A'.repeat(50) }, strict).sku).toHaveLength(50);
      expect(() => validateProductWrite({ sku: 'A'.repeat(51) }, strict)).toThrow(
        ProductValidationError,
      );
      expect(() => validateProductWrite({ sku: 'has space' }, strict)).toThrow(
        ProductValidationError,
      );
    });

    it('refuses a name over 200 characters or containing angle brackets', () => {
      expect(validateProductWrite({ name: 'N'.repeat(200) }, strict).name).toHaveLength(200);
      expect(() => validateProductWrite({ name: 'N'.repeat(201) }, strict)).toThrow(
        ProductValidationError,
      );
      for (const bad of ['<script>', 'Juice <1L', 'a > b']) {
        expect(() => validateProductWrite({ name: bad }, strict), bad).toThrow(
          ProductValidationError,
        );
      }
    });

    it('leaves the cost price rules unchanged in both modes', () => {
      // The gate must not carry the cost-price checks with it -- those are what
      // issue #530 is about and they apply either way.
      expect(() => validateProductWrite({ costPrice: -1 })).toThrow(ProductValidationError);
      expect(() => validateProductWrite({ costPrice: -1 }, strict)).toThrow(ProductValidationError);
      expect(validateProductWrite({ costPrice: '12.50' }, strict).costPrice).toBe(12.5);
    });
  });

  it('reports the offending field in the message', () => {
    // The message reaches the customer as the 400 body, so it has to say which
    // field to fix; "Invalid product" would send them guessing.
    const strict = { strictIdentifiers: true };
    expect(() => validateProductWrite({ costPrice: -1 })).toThrow(/[Cc]ost price/);
    expect(() => validateProductWrite({ barcode: 'x' }, strict)).toThrow(/[Bb]arcode/);
    expect(() => validateProductWrite({ sku: 'has space' }, strict)).toThrow(/SKU/);
    expect(() => validateProductWrite({ name: '<b>' }, strict)).toThrow(/[Pp]roduct name/);
  });
});
