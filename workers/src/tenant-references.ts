/**
 * Cross-organization reference rules for inventory writes.
 *
 * An inventory item points at a product and a store area. Both must belong to
 * the organization doing the writing — otherwise a tenant can attach its own
 * row to another tenant's data, and any query that later resolves the reference
 * hands that data back. This module owns the rule and the vocabulary for
 * rejecting it, so the check, the error messages, and the route layer's
 * classification of those errors all live in one place.
 *
 * It exists as its own module rather than as three more functions in
 * `database.ts` because the rule is a tenant-boundary rule, not a query detail,
 * and it is consumed from both the data layer (which throws) and the routing
 * layer (which maps the throw to a 400).
 */
import type { NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Errors thrown when a write references a row outside the caller's organization.
 *
 * Defined next to the check that throws them and matched by the route layer via
 * `isReferentialError`, so the throw and the match share one definition instead
 * of being two string lists kept in sync across modules. Adding a third
 * reference check means adding it here, and both catch sites pick it up.
 *
 * That coupling is not hypothetical: `handleUpdateInventoryItem` matched only
 * `Location` while `handleCreateInventoryItem` matched both, exactly mirroring
 * the missing `productId` check in `updateInventoryItem`. The new rejection
 * would have surfaced as a 500.
 *
 * The wording is deliberate. "does not exist" rather than "belongs to another
 * organization": the latter confirms the id is real, which is the disclosure
 * the 404-not-403 choice on `GET /api/products/:id` exists to avoid. From the
 * caller's side of the tenant boundary, a row it may not reference genuinely
 * does not exist.
 */
export const REFERENTIAL_ERRORS = {
  product: 'Product does not exist',
  location: 'Location does not exist',
} as const;

const REFERENTIAL_ERROR_MESSAGES: ReadonlySet<string> = new Set(Object.values(REFERENTIAL_ERRORS));

/** True when `message` is a cross-organization reference rejection (a 400, not a 500). */
export function isReferentialError(message: string): boolean {
  return REFERENTIAL_ERROR_MESSAGES.has(message);
}

/**
 * Verifies that the product and store area an inventory write references both
 * belong to the writing organization. Undefined references are skipped, so this
 * serves both the create path (both always supplied) and the update path (a
 * partial patch).
 *
 * Shared deliberately. `createInventoryItem` checked both references while
 * `updateInventoryItem` checked only the location, and that asymmetry was
 * exploitable: an authenticated user could PATCH their own item with another
 * tenant's product id (SERIAL, so enumerable), after which the report queries
 * joining `products` resolved it — leaking the foreign product's name, sku and
 * cost_price into the attacker's own loss-by-SKU report. A write became a read.
 *
 * With one helper the two paths cannot disagree about what needs checking. That
 * is the actual root cause fixed here; correlating the joins on organization is
 * the defence-in-depth half.
 */
export async function assertReferencesBelongToOrganization(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  refs: { productId?: number; locationId?: number },
): Promise<void> {
  if (refs.productId !== undefined) {
    await assertProductBelongsToOrganization(sql, organizationId, refs.productId);
  }
  if (refs.locationId !== undefined) {
    await assertStoreAreaBelongsToOrganization(sql, organizationId, refs.locationId);
  }
}

async function assertProductBelongsToOrganization(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  productId: number,
): Promise<void> {
  const rows = await sql`
    SELECT id FROM products
    WHERE id = ${productId} AND organization_id = ${organizationId} LIMIT 1`;
  if (!rows[0]) {
    throw new Error(REFERENTIAL_ERRORS.product);
  }
}

async function assertStoreAreaBelongsToOrganization(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  locationId: number,
): Promise<void> {
  const rows = await sql`
    SELECT id FROM store_areas
    WHERE id = ${locationId} AND organization_id = ${organizationId} LIMIT 1`;
  if (!rows[0]) {
    throw new Error(REFERENTIAL_ERRORS.location);
  }
}
