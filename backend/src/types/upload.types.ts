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
