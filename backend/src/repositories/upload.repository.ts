import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { UploadStatus } from '../types/upload.types';

export interface CompleteUploadStatusParams {
  rowsProcessed: number;
  rowsTotal: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowErrorCount: number;
  columnsUsed: string;
  columnsIgnored: number;
}

export interface UploadStatusRecord {
  status: string;
  uploadProgress: number;
  processingMessage: string | null;
  errorMessage: string | null;
  rowsProcessed: number;
  rowsTotal: number | null;
  rowsImported: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsSkipped: number;
  rowErrorCount: number;
  rowErrors: string | null;
  processingOffset: number;
  retryCount: number;
  failureCategory: string | null;
  errorReportKey: string | null;
  importType: string;
  tierSnapshot: string | null;
  queuedAt: Date | null;
  validationStartedAt: Date | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  columnsUsed: string | null;
  columnsIgnored: number;
  organizationId: string;
}

@injectable()
export class UploadRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findStatusByFileKey(fileKey: string): Promise<UploadStatusRecord | null> {
    const rows = await this.prisma.$queryRaw<UploadStatusRecord[]>(Prisma.sql`
      SELECT status,
             upload_progress AS "uploadProgress",
             processing_message AS "processingMessage",
             error_message AS "errorMessage",
             rows_processed AS "rowsProcessed",
             rows_total AS "rowsTotal",
             rows_imported AS "rowsImported",
             rows_updated AS "rowsUpdated",
             rows_unchanged AS "rowsUnchanged",
             rows_skipped AS "rowsSkipped",
             row_error_count AS "rowErrorCount",
             row_errors AS "rowErrors",
             processing_offset AS "processingOffset",
             retry_count AS "retryCount",
             failure_category AS "failureCategory",
             error_report_key AS "errorReportKey",
             import_type AS "importType",
             tier_snapshot AS "tierSnapshot",
             queued_at AS "queuedAt",
             validation_started_at AS "validationStartedAt",
             processing_started_at AS "processingStartedAt",
             completed_at AS "completedAt",
             failed_at AS "failedAt",
             columns_used AS "columnsUsed",
             columns_ignored AS "columnsIgnored",
             organization_id AS "organizationId"
      FROM uploads
      WHERE file_key = ${fileKey}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async markCompleted(fileKey: string, data: CompleteUploadStatusParams): Promise<any> {
    return this.prisma.upload.updateMany({
      where: { fileKey },
      data: {
        status: UploadStatus.COMPLETED,
        ...data,
      },
    });
  }

  async markFailed(fileKey: string, errorMessage?: string): Promise<any> {
    return this.prisma.upload.updateMany({
      where: { fileKey },
      data: {
        status: UploadStatus.FAILED,
        ...(errorMessage
          ? {
              errorMessage,
              rowsImported: 0,
              rowsUpdated: 0,
              rowsSkipped: 0,
              rowErrorCount: 0,
            }
          : {}),
      },
    });
  }
}
