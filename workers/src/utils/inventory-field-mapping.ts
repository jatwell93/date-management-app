/**
 * Shared utility for resolving inventory item field names.
 *
 * Supports both camelCase (preferred) and snake_case (deprecated) field names
 * for backward compatibility. camelCase takes precedence when both are present.
 */

export type InventoryItemRequestBody = {
  productId?: number;
  product_id?: number;
  expiryDate?: string;
  expiry_date?: string;
  locationId?: number;
  location_id?: number;
  status?: string;
};

export type ResolvedInventoryFields = {
  productId: number | undefined;
  expiryDate: string | undefined;
  locationId: number | undefined;
};

/**
 * Resolve inventory item fields from a request body, preferring camelCase
 * over snake_case.
 */
export function resolveInventoryFields(body: InventoryItemRequestBody): ResolvedInventoryFields {
  return {
    productId: body.productId ?? body.product_id,
    expiryDate: body.expiryDate ?? body.expiry_date,
    locationId: body.locationId ?? body.location_id,
  };
}

/**
 * Returns an array of field names for which the deprecated snake_case form is
 * present on the request body.  Used to emit per-field deprecation warnings.
 */
export function getDeprecatedSnakeCaseFields(body: InventoryItemRequestBody): string[] {
  const deprecated: string[] = [];
  if (body.product_id !== undefined) deprecated.push('product_id → productId');
  if (body.expiry_date !== undefined) deprecated.push('expiry_date → expiryDate');
  if (body.location_id !== undefined) deprecated.push('location_id → locationId');
  return deprecated;
}
