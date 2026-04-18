/**
 * Upload lifecycle status values
 * These must match the status field in the Upload Prisma model
 */
export const UploadStatus = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type UploadStatusValue = (typeof UploadStatus)[keyof typeof UploadStatus];

export const UploadImportType = {
  PRODUCT_CATALOG: 'product-catalog',
  EXPIRY_LIST: 'expiry-list',
} as const;

export type UploadImportTypeValue = (typeof UploadImportType)[keyof typeof UploadImportType];
