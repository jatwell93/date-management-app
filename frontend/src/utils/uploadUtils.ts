import * as Sentry from '@sentry/react';
import * as XLSX from 'xlsx';
import type { RejectedRowDetail, UploadResponse } from '../types/upload';

export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

export const isAllowedUploadType = (file: File): boolean => {
  return (
    file.type === 'text/csv' ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel' ||
    file.name.endsWith('.csv') ||
    file.name.endsWith('.xlsx') ||
    file.name.endsWith('.xls')
  );
};

export const validateSelectedFile = (file: File | null): string | null => {
  if (!file) {
    return 'Please select a CSV, XLSX, or XLS file to upload';
  }

  if (!isAllowedUploadType(file)) {
    return 'Please select a valid CSV, XLSX, or XLS file';
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return 'File size exceeds 10MB limit';
  }

  return null;
};

export const categorizeUploadError = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('initiate')) return 'initiate_failed';
    if (message.includes('processing')) return 'processing_failed';
    if (message.includes('upload')) return 'upload_failed';
    return 'unknown_error';
  }
  return 'unknown_error';
};

export const toUploadResultFromSummary = (summary: Record<string, unknown>): UploadResponse => {
  return {
    success: true,
    message: 'File uploaded and processed successfully',
    importedCount: Number(summary.importedCount ?? 0),
    updatedCount: Number(summary.updatedCount ?? 0),
    unchangedCount: Number(summary.unchangedCount ?? 0),
    mergedCount: Number(summary.mergedCount ?? summary.updatedCount ?? 0),
    rejectedCount: Number(summary.rejectedCount ?? summary.skippedCount ?? 0),
    errorCount: Number(summary.errorCount ?? 0),
    skippedCount: Number(summary.skippedCount ?? summary.rejectedCount ?? 0),
    processedCount: Number(summary.rowsProcessed ?? summary.processedCount ?? 0),
    totalCount: Number(summary.rowsTotal ?? summary.totalCount ?? 0),
    columnsUsed: Array.isArray(summary.columnsUsed)
      ? (summary.columnsUsed as string[])
      : undefined,
    columnsIgnored:
      typeof summary.columnsIgnored === 'number'
        ? (summary.columnsIgnored as number)
        : undefined,
    errors: Array.isArray(summary.errors) ? (summary.errors as string[]) : undefined,
    rejectedRows: Array.isArray(summary.rejectedRows)
      ? (summary.rejectedRows as RejectedRowDetail[])
      : undefined,
    errorReportUrl:
      typeof summary.errorReportUrl === 'string'
        ? (summary.errorReportUrl as string)
        : undefined,
  };
};

export const triggerFileDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const logUploadMetric = (event: string, data: Record<string, unknown>) => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  Sentry.captureMessage('client_upload_metrics', {
    level: 'info',
    extra: {
      event,
      ...data,
    },
  });
};

export const normalizeUploadFile = async (
  file: File,
  onProgress?: (msg: string) => void,
): Promise<{ fileToUpload: File; fileNameToUpload: string }> => {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  if ((fileExtension === 'xlsx' || fileExtension === 'xls') && file.type !== 'text/csv') {
    onProgress?.('Converting spreadsheet to CSV');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const fileToUpload = new File([csvContent], file.name.replace(/\.[^/.]+$/, '.csv'), {
      type: 'text/csv',
    });

    return {
      fileToUpload,
      fileNameToUpload: fileToUpload.name,
    };
  }

  return {
    fileToUpload: file,
    fileNameToUpload: file.name,
  };
};

export const uploadWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      Sentry.captureMessage('Upload attempt failed with status', {
        level: 'warning',
        extra: { attempt: i + 1, status: res.status },
      });
      if (i < retries - 1) {
        logUploadMetric('upload_retry', {
          attempt: i + 1,
          status: res.status,
          errorCategory: 'http_error',
        });
      }
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: { feature: 'csv-upload' },
          extra: { attempt: i + 1 },
        });
      } else {
        Sentry.captureMessage('Upload attempt failed with unknown error', {
          level: 'warning',
          extra: { attempt: i + 1 },
        });
      }
      if (i < retries - 1) {
        logUploadMetric('upload_retry', {
          attempt: i + 1,
          errorCategory: 'network_error',
        });
      }
    }
    if (i < retries - 1) {
      const delay = 1000 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Upload failed after multiple attempts');
};

export const downloadExpiryTemplate = (format: 'csv' | 'xlsx' | 'xls') => {
  const templateRows = [
    ['SKU', 'Item Description', 'Used-By Date', 'Department'],
    ['1001', 'Sample Vitamin C 500mg', '12/12/26', 'Vitamins'],
    ['1002', 'Sample Moisturiser 200ml', '12/2026', 'Skincare'],
  ];

  const guidanceRows = [
    ['Guidance', 'Value'],
    ['Required columns', 'SKU, Used-By Date'],
    ['Optional columns', 'Item Description, Department'],
    ['Accepted date formats', 'dd/mm/yy, dd/mm/yyyy, mm/yy, mm/yyyy, mm-yy, mm-yyyy'],
    ['Rejected examples', '12/12 (ambiguous year), Dec/2026 (month names unsupported)'],
    ['Normalization rule', 'Month-year formats normalize to the last day of the month'],
  ];

  if (format === 'csv') {
    const csvBody = templateRows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const csvGuidance = guidanceRows.map((row) => `# ${row[0]}: ${row[1]}`).join('\n');
    const csvContent = `${csvBody}\n\n${csvGuidance}\n`;

    triggerFileDownload(
      new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
      'expiry-import-template.csv',
    );
    return;
  }

  const workbook = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet(templateRows);
  const guidanceSheet = XLSX.utils.aoa_to_sheet(guidanceRows);
  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Template');
  XLSX.utils.book_append_sheet(workbook, guidanceSheet, 'Guidance');

  const binary = XLSX.write(workbook, {
    bookType: format,
    type: 'array',
  });

  const mimeType =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';
  triggerFileDownload(
    new Blob([binary], { type: mimeType }),
    `expiry-import-template.${format}`,
  );
};

export const downloadCatalogTemplate = (format: 'csv' | 'xlsx' | 'xls') => {
  const templateRows = [
    ['SKU', 'Name', 'Cost', 'Barcode'],
    ['1001', 'Sample Vitamin C 500mg', '12.99', '9312345678900'],
    ['1002', 'Sample Moisturiser 200ml', '8.50', '9312345678917'],
  ];

  const guidanceRows = [
    ['Guidance', 'Value'],
    ['Required columns', 'SKU, Name, Cost, Barcode'],
    ['Accepted SKU headers', 'SKU, Item Code, Reorder Number, Product Code, Item Number'],
    ['Accepted Name headers', 'Name, Item Description, Product Name, Description, Item Name'],
    ['Accepted Cost headers', 'Cost, Cost Price, Unit Cost, Price, Selling Price'],
    ['Accepted Barcode headers', 'Barcode, Alias, EAN, UPC, GTIN'],
    ['Cost format', 'Decimal numbers like 1.99 or 19.99 (currency symbols are stripped)'],
  ];

  if (format === 'csv') {
    const csvBody = templateRows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const csvGuidance = guidanceRows.map((row) => `# ${row[0]}: ${row[1]}`).join('\n');
    const csvContent = `${csvBody}\n\n${csvGuidance}\n`;

    triggerFileDownload(
      new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
      'product-catalog-template.csv',
    );
    return;
  }

  const workbook = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet(templateRows);
  const guidanceSheet = XLSX.utils.aoa_to_sheet(guidanceRows);
  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Template');
  XLSX.utils.book_append_sheet(workbook, guidanceSheet, 'Guidance');

  const binary = XLSX.write(workbook, {
    bookType: format,
    type: 'array',
  });

  const mimeType =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';
  triggerFileDownload(
    new Blob([binary], { type: mimeType }),
    `product-catalog-template.${format}`,
  );
};
