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
    role: z.enum(['admin', 'manager', 'team_member'] as const).optional(),
  }),
});

export const userSchema = z.object({
  body: z.object({
    pin: z
      .string()
      .min(4, 'PIN must be at least 4 digits')
      .max(6, 'PIN must be at most 6 digits')
      .regex(/^\d+$/, 'PIN must contain only digits'),
    role: z.enum(['admin', 'manager', 'team_member'] as const),
  }),
});

export const organizationInviteCreateSchema = z.object({
  body: z.object({
    email: z.string().email('Email must be valid'),
    role: z.enum(['admin', 'manager', 'team_member'] as const),
  }),
});

export const organizationInviteAcceptSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Invite token is required'),
  }),
});

export const organizationBootstrapSchema = z.object({
  body: z.object({
    organizationName: z
      .string()
      .min(1, 'Organization name is required')
      .max(100, 'Organization name must be at most 100 characters')
      .optional(),
    organizationSlug: z
      .string()
      .min(1, 'Organization slug is required')
      .max(50, 'Organization slug must be at most 50 characters')
      .regex(
        /^[a-z0-9_-]+$/,
        'Organization slug must contain only lowercase letters, numbers, hyphens, and underscores',
      )
      .optional(),
    clerkOrganizationId: z.string().min(1, 'Clerk organization ID is required').optional(),
    clerkMembershipRole: z.string().optional(),
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
    parentId: z.number().int().positive('Parent department ID must be positive').optional(),
  }),
});

const optionalIsoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Timestamp must be an ISO 8601 datetime' })
  .optional();

export const checkCycleCreateSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Check cycle name is required')
      .max(100, 'Check cycle name must be at most 100 characters')
      .refine(
        (val) => !val.includes('<') && !val.includes('>'),
        'Check cycle name cannot contain HTML tags',
      ),
    startedAt: optionalIsoDateTime,
  }),
});

export const bayCheckCreateSchema = z.object({
  body: z
    .object({
      storeAreaId: z
        .number()
        .int()
        .positive('Store area ID must be a positive integer')
        .optional()
        .or(
          z
            .string()
            .regex(/^\d+$/, 'Store area ID must be a positive integer')
            .transform((val) => parseInt(val, 10))
            .refine((val) => val > 0, 'Store area ID must be positive'),
        ),
      store_area_id: z
        .number()
        .int()
        .positive('Store area ID must be a positive integer')
        .optional()
        .or(
          z
            .string()
            .regex(/^\d+$/, 'Store area ID must be a positive integer')
            .transform((val) => parseInt(val, 10))
            .refine((val) => val > 0, 'Store area ID must be positive'),
        ),
      checkedAt: optionalIsoDateTime,
      checked_at: optionalIsoDateTime,
      itemsAddedCount: z
        .number()
        .int()
        .nonnegative('Items added count must be a non-negative integer')
        .optional(),
      items_added_count: z
        .number()
        .int()
        .nonnegative('Items added count must be a non-negative integer')
        .optional(),
      notes: z.string().max(1000, 'Notes must be at most 1000 characters').nullable().optional(),
    })
    .refine((body) => body.storeAreaId !== undefined || body.store_area_id !== undefined, {
      message: 'Store area ID is required',
      path: ['storeAreaId'],
    }),
});

// ============================================================================
// Supplier Credit Schemas
// ============================================================================

const noHtml = (val: string) => !val.includes('<') && !val.includes('>');

// A credit ratio needs both legs or neither — a lone quantity is meaningless.
const supplierBody = z.object({
  name: z
    .string()
    .min(1, 'Supplier name is required')
    .max(120, 'Supplier name must be at most 120 characters')
    .refine(noHtml, 'Supplier name cannot contain HTML tags'),
  contactEmail: z
    .string()
    .email('Contact email must be a valid email address')
    .max(255)
    .nullable()
    .optional(),
  contactPhone: z
    .string()
    .max(80, 'Contact phone must be at most 80 characters')
    .nullable()
    .optional(),
  creditPolicyNote: z
    .string()
    .max(10000, 'Credit policy note must be at most 10000 characters')
    .optional(),
  creditType: z.enum(['NONE', 'FULL_CREDIT'] as const).optional(),
  policyWriteOffQty: z
    .number()
    .int()
    .positive('Write-off quantity must be a positive integer')
    .nullable()
    .optional(),
  policyCreditQty: z
    .number()
    .int()
    .nonnegative('Credit quantity must be a non-negative integer')
    .nullable()
    .optional(),
  followUpDays: z
    .number()
    .int()
    .min(1, 'Follow-up cadence must be at least 1 day')
    .max(365, 'Follow-up cadence must be at most 365 days')
    .optional(),
  representativeName: z
    .string()
    .max(120, 'Representative name must be at most 120 characters')
    .nullable()
    .optional(),
  representativeEmail: z
    .string()
    .email('Representative email must be a valid email address')
    .max(255)
    .nullable()
    .optional(),
});

export const supplierCreateSchema = z.object({ body: supplierBody });
export const supplierUpdateSchema = z.object({ body: supplierBody });
export const supplierPatchSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      contactEmail: z.string().email().max(255).nullable().optional(),
      contactPhone: z.string().max(80).nullable().optional(),
      creditPolicyNote: z.string().max(10000).optional(),
      creditType: z.enum(['NONE', 'FULL_CREDIT'] as const).optional(),
      policyWriteOffQty: z.number().int().positive().nullable().optional(),
      policyCreditQty: z.number().int().nonnegative().nullable().optional(),
      followUpDays: z.number().int().min(1).max(365).optional(),
      representativeName: z.string().max(120).nullable().optional(),
      representativeEmail: z.string().email().max(255).nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, 'Provide at least one supplier field'),
});

// Cardinality is enforced in the policy service so 0/501-item domain failures
// use the public structured 422 contract instead of generic Zod 400 handling.
const positiveIdBatch = z.array(z.number().int().positive());

export const bulkAttachPolicySchema = z.object({
  body: z.object({ supplierId: z.number().int().positive(), brandIds: positiveIdBatch }),
});

export const bulkLinkProductsSchema = z.object({
  body: z
    .object({
      brandId: z.number().int().positive().optional(),
      brandName: z.string().trim().min(1).max(160).optional(),
      productIds: positiveIdBatch,
    })
    .refine((body) => (body.brandId == null) !== (body.brandName == null), {
      message: 'Provide exactly one brandId or brandName',
      path: ['brandId'],
    }),
});

export const assignSupplierSchema = z.object({
  body: z.object({
    supplierId: z.number().int().positive('Supplier ID must be a positive integer').nullable(),
  }),
});

export const brandCreateSchema = z.object({
  body: z.object({
    productId: z.number().int().positive('Product ID must be a positive integer'),
    name: z.string().trim().min(1, 'Brand name is required').max(160),
    supplierId: z
      .number()
      .int()
      .positive('Supplier ID must be a positive integer')
      .nullable()
      .optional(),
  }),
});

export const brandSupplierSchema = z.object({
  body: z.object({
    supplierId: z.number().int().positive('Supplier ID must be a positive integer'),
  }),
});

export const correctionReviewSchema = z.object({
  body: z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) }),
});

export const claimCreateSchema = z.object({
  body: z.object({
    supplierId: z.number().int().positive('Supplier ID must be a positive integer'),
    lines: z
      .array(
        z.object({
          expiredItemTransactionId: z
            .number()
            .int()
            .positive('Write-off ID must be a positive integer'),
          batchNumber: z
            .string()
            .max(120, 'Batch number must be at most 120 characters')
            .refine(noHtml, 'Batch number cannot contain HTML tags')
            .nullable()
            .optional(),
          unitsClaimed: z
            .number()
            .int()
            .positive('Units claimed must be a positive integer')
            .optional(),
        }),
      )
      .min(1, 'A claim needs at least one line'),
  }),
});

export const claimOutcomeSchema = z.object({
  body: z.object({
    outcome: z.enum(['CREDITED', 'PARTIALLY_CREDITED', 'REJECTED']),
    creditedValue: z
      .number()
      .nonnegative('Credited value must be zero or greater')
      .nullable()
      .optional(),
    note: z.string().max(1000, 'Note must be at most 1000 characters').nullable().optional(),
  }),
});

// ============================================================================
// Upload Schema
// ============================================================================

const uploadImportTypeSchema = z.enum(['product-catalog', 'expiry-list']);

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
    importType: uploadImportTypeSchema.optional(),
  }),
});

export const uploadCompleteSchema = z.object({
  body: z.object({
    key: z
      .string()
      .min(1, 'Upload key is required')
      .regex(
        /^uploads\/[a-zA-Z0-9_-]+\/\d+-[a-zA-Z0-9_\-. ]+$/,
        'Invalid upload key format (expected: uploads/{orgId}/{timestamp}-{filename})',
      ),
    importType: uploadImportTypeSchema.optional(),
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
        path.normalize(val);
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
// Markdown Matrix Schema (issue #338)
// ============================================================================

const markdownBandSchema = z.object({
  percentage: z
    .number({ error: 'Discount percentage must be a number' })
    .min(0, 'Discount percentage cannot be below 0')
    .max(100, 'Discount percentage cannot exceed 100'),
  basis: z.enum(['cost', 'retail'], { error: "Basis must be 'cost' or 'retail'" }),
});

const markdownMatrixSchema = z
  .object({
    band1: markdownBandSchema,
    band2: markdownBandSchema,
    band3: markdownBandSchema,
  })
  .refine(
    (matrix) =>
      matrix.band1.percentage <= matrix.band2.percentage &&
      matrix.band2.percentage <= matrix.band3.percentage,
    {
      message:
        'Discounts must not decrease as expiry nears: band 1 (61-90 days) ≤ band 2 (31-60 days) ≤ band 3 (0-30 days).',
      path: ['band3', 'percentage'],
    },
  );

export const markdownConfigSchema = z.object({
  body: z.union([
    markdownMatrixSchema,
    z.object({
      matrices: z.object({
        NO_CREDIT: markdownMatrixSchema,
        FULL_CREDIT: markdownMatrixSchema,
      }),
    }),
  ]),
});

// ============================================================================
// Type Exports
// ============================================================================

export type MarkdownConfigInput = z.infer<typeof markdownConfigSchema.shape.body>;
export type LoginInput = z.infer<typeof loginSchema.shape.body>;
export type UserInput = z.infer<typeof userSchema.shape.body>;
export type ProductInput = z.infer<typeof productSchema.shape.body>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema.shape.body>;
export type InventoryTransactionInput = z.infer<typeof inventoryTransactionSchema.shape.body>;
export type StoreAreaInput = z.infer<typeof storeAreaSchema.shape.body>;
export type CheckCycleCreateInput = z.infer<typeof checkCycleCreateSchema.shape.body>;
export type BayCheckCreateInput = z.infer<typeof bayCheckCreateSchema.shape.body>;
export type UploadInitiateInput = z.infer<typeof uploadInitiateSchema.shape.body>;
export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema.shape.body>;
