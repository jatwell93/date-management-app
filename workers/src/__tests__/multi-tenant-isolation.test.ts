/**
 * Cross-tenant data isolation — POINTER FILE.
 *
 * This file used to contain eight tests whose bodies were a prose scenario
 * followed by `const expected = true; expect(expected).toBe(true)`. They passed,
 * the runner counted them, and they constrained nothing. Two of them were named
 * "Organization A cannot see Organization B products" and "Organization B cannot
 * read Organization A product by ID", with the comment "FK + organizationId
 * filter prevents access".
 *
 * Both statements were false. `findProducts`, `findProductById`, `countProducts`,
 * `findInventoryItems`, `countInventoryItems` and `findStoreAreas` had no
 * organization predicate at all, so `GET /api/products`, `GET /api/products/:id`,
 * `GET /api/inventory-items` and `GET /api/store-areas` returned every tenant's
 * rows to any authenticated user. The tests that claimed to cover this are the
 * reason it survived: a green suite, a file named for the property, and a
 * confident comment.
 *
 * The real coverage now lives in `../database.tenant-isolation.pglite.node.test.ts`
 * — ten assertions against real SQL with seeded foreign-organization rows, each
 * verified to fail when the predicate is removed. It runs under `npm run test:db`
 * and is gated by the "Workers Real-SQL Tests" job in `.github/workflows/workers-test.yml`.
 *
 * The suite below is skipped with a name that says where it went, rather than
 * deleted outright: many audit-manifest rows in
 * `openspec/changes/retire-express-unify-on-postgres/audit/` cite this path as
 * searched-and-empty evidence, and those citations must keep resolving. The
 * skip is "relocated", not "not yet written".
 *
 * If you are about to add a test here: add it to the pglite file instead, where
 * it can touch a real database and actually fail.
 */
import { describe, it } from 'vitest';

describe.skip('Cross-tenant isolation — relocated to database.tenant-isolation.pglite.node.test.ts', () => {
  it('is asserted there against real SQL, not here against a constant', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});
