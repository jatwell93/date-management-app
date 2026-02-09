/**
 * Zod Validation Schemas for Phase 13 Security Hardening
 *
 * Centralized validation schemas for all API endpoints using Zod.
 * Provides type-safe validation with detailed error messages.
 */

import { z } from 'zod';

// ============================================================================
// User & Authentication Schemas
// ============================================================================

export const loginSchema = z.object({
  body: z.object({
    pin: z
      .string()
      .min(4, 'PIN must be at least 4 digits')
      .max(6, 'PIN must be at most 6 digits')
      .regex(/^\d+$/, 'PIN must contain only digits'),
    role: z.enum(['Manager', 'Team Member'] as const).optional(),
  }),
});

export const userSchema = z.object({
  body: z.object({
    pin: z
      .string()
      .min(4, 'PIN must be at least 4 digits')
      .max(6, 'PIN must be at most 6 digits')
      .regex(/^\d+$/, 'PIN must contain only digits'),
    role: z.enum(['Manager', 'Team Member'] as const),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required').optional(),
  }),
});

// ============================================================================
// Product Schemas
// ============================================================================

export const productSchema = z.object({
  body: z.object({
    barcode: z
      .string()
      .min(8, 'Barcode must be at least 8 characters')
      .max(14, 'Barcode must be at most 14 characters')
      .regex(/^[a-zA-Z0-9-]+$/, 'Barcode must be alphanumeric with optional hyphens')
      .optional(),
    sku: z
      .string()
      .max(50, 'SKU must be at most 50 characters')
      .regex(/^[a-zA-Z0-9-]+$/, 'SKU must be alphanumeric with optional hyphens')
      .optional(),
    name: z
      .string()
      .max(200, 'Product name must be at most 200 characters')
      .refine(
        (val) => !val.includes('<') && !val.includes('>'),
        'Product name cannot contain HTML tags',
      )
      .optional(),
    costPrice: z
      .number()
      .nonnegative('Cost price must be a non-negative number')
      .max(10000, 'Cost price seems unusually high. Please verify.')
      .optional()
      .or(
        z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Cost price must be a valid number')
          .transform((val) => parseFloat(val))
          .refine((val) => val >= 0, 'Cost price must be non-negative')
          .refine((val) => val <= 10000, 'Cost price seems unusually high. Please verify.'),
      ),
  }),
});

// ============================================================================
// Inventory Schemas
// ============================================================================

export const inventoryItemSchema = z.object({
  body: z.object({
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
      .refine((date) => {
        const expiry = new Date(date);
        expiry.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expiry >= today;
      }, 'Expiry date cannot be in the past')
      .optional(),
    productId: z
      .number()
      .int()
      .positive('Product ID must be a positive integer')
      .optional()
      .or(
        z
          .string()
          .regex(/^\d+$/, 'Product ID must be a positive integer')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val > 0, 'Product ID must be positive'),
      ),
    locationId: z
      .number()
      .int()
      .positive('Location ID must be a positive integer')
      .optional()
      .or(
        z
          .string()
          .regex(/^\d+$/, 'Location ID must be a positive integer')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val > 0, 'Location ID must be positive'),
      ),
    status: z
      .enum([
        'Normal',
        'Near Expiry',
        'Expired',
        'Damaged',
        'Markdown 1',
        'Markdown 2',
        'Markdown 3',
      ] as const)
      .optional(),
    quantity: z
      .number()
      .int()
      .nonnegative('Quantity must be a non-negative integer')
      .optional()
      .or(
        z
          .string()
          .regex(/^\d+$/, 'Quantity must be a non-negative integer')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val >= 0, 'Quantity must be non-negative'),
      ),
  }),
});

export const inventoryTransactionSchema = z.object({
  body: z.object({
    inventory_item_id: z
      .number()
      .int()
      .positive('Inventory item ID must be a positive integer')
      .or(
        z
          .string()
          .regex(/^\d+$/, 'Inventory item ID must be a positive integer')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val > 0, 'Inventory item ID must be positive'),
      ),
    user_id: z
      .number()
      .int()
      .positive('User ID must be a positive integer')
      .or(
        z
          .string()
          .regex(/^\d+$/, 'User ID must be a positive integer')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val > 0, 'User ID must be positive'),
      ),
    type: z.enum(['in', 'out', 'adjustment'] as const),
    quantity_change: z
      .number()
      .finite('Quantity change must be a finite number')
      .or(
        z
          .string()
          .regex(/^-?\d+(\.\d+)?$/, 'Quantity change must be a valid number')
          .transform((val) => parseFloat(val)),
      ),
    notes: z.string().max(500, 'Notes must be at most 500 characters').optional(),
  }),
});

// ============================================================================
// Store Area Schema
// ============================================================================

export const storeAreaSchema = z.object({
  body: z.object({
    name: z
      .string()
      .max(100, 'Store area name must be at most 100 characters')
      .refine(
        (val) => !val.includes('<') && !val.includes('>'),
        'Store area name cannot contain HTML tags',
      ),
    subDepartment: z
      .string()
      .max(50, 'Sub-department must be at most 50 characters')
      .refine(
        (val) => !val.includes('<') && !val.includes('>'),
        'Sub-department cannot contain HTML tags',
      )
      .optional(),
    lastChecked: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Last checked date must be in YYYY-MM-DD format')
      .optional(),
  }),
});

// ============================================================================
// Upload Schema
// ============================================================================

export const uploadInitiateSchema = z.object({
  body: z.object({
    filename: z
      .string()
      .min(1, 'Filename is required')
      .max(255, 'Filename must be at most 255 characters')
      .regex(/^[a-zA-Z0-9_\-. ]+$/, 'Filename contains invalid characters')
      .refine((val) => val.endsWith('.csv'), 'File must be a CSV file'),
    fileSize: z
      .number()
      .positive('File size must be positive')
      .max(10 * 1024 * 1024, 'File size exceeds maximum limit of 10MB')
      .or(
        z
          .string()
          .regex(/^\d+$/, 'File size must be a positive number')
          .transform((val) => parseInt(val, 10))
          .refine((val) => val > 0 && val <= 10 * 1024 * 1024, 'Invalid file size'),
      ),
    contentType: z
      .string()
      .refine(
        (val) => ['text/csv', 'application/csv', 'text/plain'].includes(val),
        'Content type must be CSV',
      ),
  }),
});

export const uploadCompleteSchema = z.object({
  body: z.object({
    key: z
      .string()
      .min(1, 'Upload key is required')
      .regex(/^uploads\/\d+-[a-zA-Z0-9_\-. ]+$/, 'Invalid upload key format'),
  }),
});

// ============================================================================
// Database Backup Schema
// ============================================================================

export const backupRestoreSchema = z.object({
  body: z.object({
    backupPath: z
      .string()
      .min(1, 'Backup path is required')
      .refine(
        (val) => !val.includes('..'),
        'Backup path cannot contain parent directory references',
      )
      .refine((val) => {
        const path = require('path');
        const normalized = path.normalize(val);
        const baseDir = path.resolve('backups');
        const resolved = path.resolve(val);
        return resolved.startsWith(baseDir + path.sep);
      }, 'Backup path must be within backups directory'),
  }),
});

// ============================================================================
// Expired Items Schema
// ============================================================================

export const expiredItemProcessSchema = z
  .object({
    body: z.object({
      inventoryItemId: z
        .number()
        .int()
        .positive('Inventory item ID must be a positive integer')
        .or(
          z
            .string()
            .regex(/^\d+$/, 'Inventory item ID must be a positive integer')
            .transform((val) => parseInt(val, 10))
            .refine((val) => val > 0, 'Inventory item ID must be positive'),
        ),
      action: z.enum(['sold_through', 'expired'] as const),
      unitsDiscarded: z
        .number()
        .int()
        .positive('Units discarded must be a positive integer')
        .optional()
        .or(
          z
            .string()
            .regex(/^\d+$/, 'Units discarded must be a positive integer')
            .transform((val) => parseInt(val, 10))
            .refine((val) => val > 0, 'Units discarded must be positive'),
        ),
      notes: z.string().max(500, 'Notes must be at most 500 characters').optional(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.body.action === 'expired' && data.body.unitsDiscarded === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'unitsDiscarded'],
        message: 'Units discarded is required when action is expired',
      });
    }
  });

// ============================================================================
// Query Parameter Schemas
// ============================================================================

export const paginationSchema = z.object({
  query: z.object({
    page: z
      .string()
      .regex(/^\d+$/, 'Page must be a positive integer')
      .transform((val) => parseInt(val, 10))
      .refine((val) => val > 0, 'Page must be positive')
      .optional()
      .default(1),
    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be a positive integer')
      .transform((val) => parseInt(val, 10))
      .refine((val) => val > 0 && val <= 100, 'Limit must be between 1 and 100')
      .optional()
      .default(20),
  }),
});

export const idParamSchema = z.object({
  params: z.object({
    id: z
      .string()
      .regex(/^\d+$/, 'ID must be a positive integer')
      .transform((val) => parseInt(val, 10))
      .refine((val) => val > 0, 'ID must be positive'),
  }),
});

// ============================================================================
// Type Exports
// ============================================================================

export type LoginInput = z.infer<typeof loginSchema.shape.body>;
export type UserInput = z.infer<typeof userSchema.shape.body>;
export type ProductInput = z.infer<typeof productSchema.shape.body>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema.shape.body>;
export type InventoryTransactionInput = z.infer<typeof inventoryTransactionSchema.shape.body>;
export type StoreAreaInput = z.infer<typeof storeAreaSchema.shape.body>;
export type UploadInitiateInput = z.infer<typeof uploadInitiateSchema.shape.body>;
export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema.shape.body>;
