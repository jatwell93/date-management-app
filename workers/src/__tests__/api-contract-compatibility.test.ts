import { describe, it, expect } from 'vitest';
import {
  resolveInventoryFields,
  getDeprecatedSnakeCaseFields,
  InventoryItemRequestBody,
} from '../utils/inventory-field-mapping';

describe('API Contract Compatibility - Field Mapping Logic', () => {
  describe('resolveInventoryFields', () => {
    it('should map camelCase fields correctly', () => {
      const body: InventoryItemRequestBody = {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
        status: 'active',
      };

      const { productId, expiryDate, locationId } = resolveInventoryFields(body);

      expect(productId).toBe(1);
      expect(expiryDate).toBe('2026-12-31');
      expect(locationId).toBe(1);
    });

    it('should map snake_case fields correctly (backward compatibility)', () => {
      const body: InventoryItemRequestBody = {
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
        status: 'active',
      };

      const { productId, expiryDate, locationId } = resolveInventoryFields(body);

      expect(productId).toBe(1);
      expect(expiryDate).toBe('2026-12-31');
      expect(locationId).toBe(1);
    });

    it('should prioritize camelCase over snake_case when both are provided', () => {
      const body: InventoryItemRequestBody = {
        productId: 2, // Should take precedence
        product_id: 1, // Should be ignored
        expiryDate: '2026-12-31',
        locationId: 1,
        status: 'active',
      };

      const { productId, expiryDate, locationId } = resolveInventoryFields(body);

      expect(productId).toBe(2);
      expect(expiryDate).toBe('2026-12-31');
      expect(locationId).toBe(1);
    });

    it('should return undefined for missing required fields', () => {
      const body: InventoryItemRequestBody = {
        // Missing both productId and product_id
        expiry_date: '2026-12-31',
        location_id: 1,
      };

      const { productId, expiryDate, locationId } = resolveInventoryFields(body);

      expect(productId).toBeUndefined();
      expect(expiryDate).toBe('2026-12-31');
      expect(locationId).toBe(1);
    });
  });

  describe('getDeprecatedSnakeCaseFields', () => {
    it('should report all deprecated snake_case fields when present', () => {
      const body: InventoryItemRequestBody = {
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
      };

      const deprecated = getDeprecatedSnakeCaseFields(body);

      expect(deprecated).toHaveLength(3);
      expect(deprecated[0]).toContain('product_id');
      expect(deprecated[1]).toContain('expiry_date');
      expect(deprecated[2]).toContain('location_id');
    });

    it('should report snake_case fields as deprecated even when camelCase is also present', () => {
      // When both are provided, the snake_case field is still present and still deprecated
      const body: InventoryItemRequestBody = {
        productId: 2,
        product_id: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      };

      const deprecated = getDeprecatedSnakeCaseFields(body);

      expect(deprecated).toHaveLength(1);
      expect(deprecated[0]).toContain('product_id');
    });

    it('should return empty array when only camelCase fields are used', () => {
      const body: InventoryItemRequestBody = {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      };

      const deprecated = getDeprecatedSnakeCaseFields(body);

      expect(deprecated).toHaveLength(0);
    });
  });
});
