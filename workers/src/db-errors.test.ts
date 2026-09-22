/**
 * The unique-violation predicate had two copies in this package: a hardened one in
 * index-minimal.ts and a weaker one in credit-claim-database.ts that missed the nested
 * shape, so the same collision answered 409 on one path and 500 on another. They are
 * one function now; these pin the shapes that made the difference.
 */
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './db-errors';

describe('isUniqueViolation', () => {
  it('recognises a flat pg error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('recognises a pg error nested under cause', () => {
    // Some Neon driver wrappers nest it. Missing this shape is what turned the one
    // case the unique constraint exists to catch into an opaque 500.
    expect(
      isUniqueViolation(
        Object.assign(new Error('insert failed'), {
          cause: { code: '23505' },
        }),
      ),
    ).toBe(true);
  });

  it('does not claim other constraint violations', () => {
    // 23503 is foreign_key_violation — a different failure with a different remedy.
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('fk'), { cause: { code: '23503' } }))).toBe(
      false,
    );
  });

  it('does not match on message text alone', () => {
    // The old copy fell back to a substring match, which is locale- and
    // version-dependent — and would classify an unrelated error carrying that phrase.
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(
      false,
    );
  });

  it.each([[null], [undefined], ['23505'], [23505]])('is false for %p', (value) => {
    expect(isUniqueViolation(value)).toBe(false);
  });
});
