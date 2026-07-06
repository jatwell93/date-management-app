import type { UploadImportType } from '../utils/csvValidator';

export interface RejectedRowDetail {
  rowNumber: number;
  rawValues: {
    sku: string;
    itemDescription: string;
    usedByDate: string;
  };
  reason: string;
  reasonCode?: string;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  importedCount?: number;
  updatedCount?: number;
  unchangedCount?: number;
  mergedCount?: number;
  rejectedCount?: number;
  errorCount?: number;
  skippedCount?: number;
  processedCount?: number;
  totalCount?: number;
  rejectedRows?: RejectedRowDetail[];
  errors?: string[];
  columnsUsed?: string[];
  columnsIgnored?: number;
  errorReportUrl?: string;
}

export interface LastUploadSummary {
  fileName: string;
  importType: UploadImportType;
  status: 'completed';
  importedCount: number;
  updatedCount: number;
  rejectedCount: number;
  processedCount: number;
}

export const LAST_UPLOAD_SUMMARY_KEY = 'csvUpload:lastUploadSummary';
