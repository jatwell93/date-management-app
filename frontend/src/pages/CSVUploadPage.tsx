import React, { useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import * as XLSX from 'xlsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  validateCSVColumns,
  estimateRowCount,
  formatColumnValidationError,
  type ColumnValidationResult,
  type RowEstimate,
  type UploadImportType,
} from '../utils/csvValidator';
import { buildApiUrl } from '../lib/api.service';

interface RejectedRowDetail {
  rowNumber: number;
  rawValues: {
    sku: string;
    itemDescription: string;
    usedByDate: string;
  };
  reason: string;
  reasonCode?: string;
}

interface UploadResponse {
  success: boolean;
  message: string;
  importedCount?: number;
  updatedCount?: number;
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
}

interface LastUploadSummary {
  fileName: string;
  importType: UploadImportType;
  status: 'completed';
  importedCount: number;
  updatedCount: number;
  rejectedCount: number;
  processedCount: number;
}

const LAST_UPLOAD_SUMMARY_KEY = 'csvUpload:lastUploadSummary';

export const CSVUploadPage: React.FC<{
  token: string | null;
  defaultImportType?: UploadImportType;
}> = ({ token, defaultImportType = 'product-catalog' }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawReturnUrl = searchParams.get('return');
  // Only allow safe in-app paths: must start with a single '/' and must not contain a protocol or '//'
  const returnUrl =
    rawReturnUrl && /^\/[^/]/.test(rawReturnUrl) && !rawReturnUrl.includes('://')
      ? rawReturnUrl
      : null;

  const fileInputId = 'csv-upload-file-input';
  const formatGuidelinesId = 'csv-upload-format-guidelines';
  const productCatalogPanelId = 'csv-upload-product-catalog-panel';
  const expiryListPanelId = 'csv-upload-expiry-list-panel';
  const formatGuidelinesRef = useRef<HTMLDivElement | null>(null);
  const [importType, setImportType] = useState<UploadImportType>(defaultImportType);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string[][]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [columnValidation, setColumnValidation] = useState<ColumnValidationResult | null>(null);
  const [rowEstimate, setRowEstimate] = useState<RowEstimate | null>(null);
  const [lastUploadSummary, setLastUploadSummary] = useState<LastUploadSummary | null>(() => {
    const storedSummary = localStorage.getItem(LAST_UPLOAD_SUMMARY_KEY);
    if (!storedSummary) {
      return null;
    }

    try {
      return JSON.parse(storedSummary) as LastUploadSummary;
    } catch (_error) {
      localStorage.removeItem(LAST_UPLOAD_SUMMARY_KEY);
      return null;
    }
  });

  const logUploadMetric = (event: string, data: Record<string, unknown>) => {
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

  const categorizeUploadError = (error: unknown): string => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('initiate')) return 'initiate_failed';
      if (message.includes('processing')) return 'processing_failed';
      if (message.includes('upload')) return 'upload_failed';
      return 'unknown_error';
    }
    return 'unknown_error';
  };

  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

  const isAllowedUploadType = (file: File): boolean => {
    return (
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel' ||
      file.name.endsWith('.csv') ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls')
    );
  };

  const validateSelectedFile = (file: File | null): string | null => {
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

  const isExpiryImport = importType === 'expiry-list';

  const toUploadResultFromSummary = (summary: Record<string, unknown>): UploadResponse => {
    return {
      success: true,
      message: 'File uploaded and processed successfully',
      importedCount: Number(summary.importedCount ?? 0),
      updatedCount: Number(summary.updatedCount ?? 0),
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
        typeof summary.columnsIgnored === 'number' ? (summary.columnsIgnored as number) : undefined,
      rejectedRows: Array.isArray(summary.rejectedRows)
        ? (summary.rejectedRows as RejectedRowDetail[])
        : undefined,
    };
  };

  const recordCompletedUpload = (
    result: UploadResponse,
    completedFileName: string,
    completedImportType: UploadImportType,
  ) => {
    setUploadResult(result);

    const summary: LastUploadSummary = {
      fileName: completedFileName,
      importType: completedImportType,
      status: 'completed',
      importedCount: result.importedCount ?? 0,
      updatedCount: result.updatedCount ?? result.mergedCount ?? 0,
      rejectedCount: result.rejectedCount ?? result.skippedCount ?? 0,
      processedCount: result.processedCount ?? result.totalCount ?? 0,
    };

    setLastUploadSummary(summary);
    localStorage.setItem(LAST_UPLOAD_SUMMARY_KEY, JSON.stringify(summary));
  };

  const triggerFileDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadExpiryTemplate = (format: 'csv' | 'xlsx' | 'xls') => {
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
    triggerFileDownload(new Blob([binary], { type: mimeType }), `expiry-import-template.${format}`);
  };

  const normalizeUploadFile = async (
    file: File,
  ): Promise<{ fileToUpload: File; fileNameToUpload: string }> => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if ((fileExtension === 'xlsx' || fileExtension === 'xls') && file.type !== 'text/csv') {
      setProgressMessage('Converting spreadsheet to CSV');
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

  const uploadWithRetry = async (url: string, options: RequestInit, retries = 3) => {
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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file);
      setFileName(file.name);
      setUploadResult(null); // Reset any previous results
      setColumnValidation(null);
      setRowEstimate(null);

      // Generate preview of the first 5 rows
      previewFile(file);

      // Validate columns (async)
      try {
        const validation = await validateCSVColumns(file, importType);
        setColumnValidation(validation);
      } catch (_error) {
        // Non-blocking - will be caught during upload
      }

      // Estimate row count
      const estimate = estimateRowCount(file);
      setRowEstimate(estimate);
    }
  };

  const previewFile = (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      // Handle XLSX and XLS files
      const reader = new FileReader();

      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert the worksheet to JSON format with header: 1 to get array of arrays
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Limit to first 6 rows for preview
        const previewData = jsonData.slice(0, 6) as string[][];
        setFilePreview(previewData);
      };

      reader.readAsArrayBuffer(file);
    } else {
      // Handle CSV files (existing logic)
      const reader = new FileReader();

      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split('\n').slice(0, 6); // Take first 6 lines (header + 5 data rows)
        const previewData = lines.map((line) => line.split(',').map((cell) => cell.trim()));
        setFilePreview(previewData);
      };

      reader.readAsText(file);
    }
  };

  const pollUploadStatus = async (
    key: string,
    completedFileName: string,
    completedImportType: UploadImportType,
  ) => {
    const maxAttempts = 30; // 30 seconds max
    const pollInterval = 1000; // 1 second
    const nonRetryableStatusCodes = new Set([400, 401, 403, 404]);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // URL encode the key to handle slashes in the path
        const encodedKey = encodeURIComponent(key);
        const statusRes = await fetch(buildApiUrl(`/upload/status/${encodedKey}`), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!statusRes.ok) {
          if (nonRetryableStatusCodes.has(statusRes.status)) {
            let statusErrorMessage = '';

            try {
              const errorBody = (await statusRes.json()) as {
                error?: unknown;
                message?: unknown;
              };
              const apiMessage =
                typeof errorBody.error === 'string'
                  ? errorBody.error
                  : typeof errorBody.message === 'string'
                    ? errorBody.message
                    : '';

              if (apiMessage) {
                statusErrorMessage = `: ${apiMessage}`;
              }
            } catch (_parseError) {
              // Ignore malformed/empty error payloads and fall back to generic message.
            }

            throw new Error(`Processing failed${statusErrorMessage}`);
          }

          throw new Error(`Failed to get upload status (HTTP ${statusRes.status})`);
        }

        const statusData = await statusRes.json();

        if (statusData.status === 'complete' || statusData.status === 'completed') {
          recordCompletedUpload(
            toUploadResultFromSummary(statusData),
            completedFileName,
            completedImportType,
          );
          return;
        } else if (statusData.status === 'failed') {
          setUploadResult({
            success: false,
            message: statusData.error || 'Processing failed',
          });
          return;
        }

        // Still processing, update progress
        setUploadProgress(statusData.progress || 0);
        setProgressMessage(statusData.message || 'Processing file');

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Processing failed')) {
          throw error;
        }

        // Continue polling on transient errors.
      }
    }

    // Timeout
    setUploadResult({
      success: false,
      message: 'Processing timed out. Please check your uploads.',
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const validationError = validateSelectedFile(selectedFile);
    if (validationError) {
      setUploadResult({
        success: false,
        message: validationError,
      });
      return;
    }

    // Check column validation
    if (columnValidation && !columnValidation.isValid) {
      setUploadResult({
        success: false,
        message: formatColumnValidationError(columnValidation),
      });
      return;
    }

    const file = selectedFile;
    if (!file) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setProgressMessage('Preparing file');
    setUploadResult(null);

    const uploadStartTime = Date.now();

    try {
      const { fileToUpload, fileNameToUpload } = await normalizeUploadFile(file);

      // 1. Initiate Upload
      setProgressMessage('Starting upload');
      const uploadBaseUrl = buildApiUrl('/upload');

      const initiateRes = await fetch(`${uploadBaseUrl}/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: fileNameToUpload,
          fileSize: fileToUpload.size,
          contentType: fileToUpload.type,
          importType,
        }),
      });

      if (!initiateRes.ok) {
        throw new Error('Failed to initiate upload');
      }

      const { strategy, uploadUrl, method, key } = await initiateRes.json();

      // 2. Perform Upload
      setProgressMessage('Uploading file');

      // Simulate progress for user feedback
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 500);

      let uploadKey = key; // From initiate

      try {
        if (strategy === 'direct') {
          const formData = new FormData();
          formData.append('file', fileToUpload);
          formData.append('importType', importType);

          const directUrl = uploadUrl.startsWith('http') ? uploadUrl : `${uploadBaseUrl}/direct`;

          const directRes = await uploadWithRetry(directUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          if (!directRes.ok) {
            throw new Error('Direct upload failed');
          }

          const directData = await directRes.json();
          uploadKey = directData.key || key; // Use key from response if available

          if (isExpiryImport && directData.importedCount !== undefined) {
            recordCompletedUpload(toUploadResultFromSummary(directData), file.name, importType);
            setUploadProgress(0);
            setProgressMessage('');

            logUploadMetric('upload_complete', {
              fileSize: fileToUpload.size,
              durationMs: Date.now() - uploadStartTime,
              result: 'success',
              method: strategy,
              fileType: fileToUpload.type,
              importType,
            });
            return;
          }
        } else {
          // Presigned PUT
          await uploadWithRetry(uploadUrl, {
            method: method,
            headers: {
              'Content-Type': fileToUpload.type,
            },
            body: fileToUpload,
          });
        }
      } finally {
        clearInterval(progressInterval);
      }

      setUploadProgress(100);

      // 3. Complete (Trigger Processing)
      if (strategy === 'presigned') {
        setProgressMessage('Processing file');
        const completeRes = await fetch(`${uploadBaseUrl}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key: uploadKey, importType }),
        });

        if (!completeRes.ok) throw new Error('Processing failed');

        const completeData = await completeRes.json();
        if (isExpiryImport && completeData.importedCount !== undefined) {
          recordCompletedUpload(toUploadResultFromSummary(completeData), file.name, importType);

          logUploadMetric('upload_complete', {
            fileSize: fileToUpload.size,
            durationMs: Date.now() - uploadStartTime,
            result: 'success',
            method: strategy,
            fileType: fileToUpload.type,
            importType,
          });
          setUploadProgress(0);
          setProgressMessage('');
          return;
        }
      }

      // Poll for processing completion
      await pollUploadStatus(uploadKey, file.name, importType);

      logUploadMetric('upload_complete', {
        fileSize: fileToUpload.size,
        durationMs: Date.now() - uploadStartTime,
        result: 'success',
        method: strategy,
        fileType: fileToUpload.type,
        importType,
      });
      setUploadProgress(0);
      setProgressMessage('');
    } catch (error) {
      if (error instanceof Error) {
        Sentry.captureException(error, {
          tags: { feature: 'csv-upload' },
        });
      } else {
        Sentry.captureMessage('Upload failed with unknown error', {
          level: 'error',
          tags: { feature: 'csv-upload' },
        });
      }
      setUploadResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred during upload',
      });
      logUploadMetric('upload_complete', {
        fileSize: file.size,
        durationMs: Date.now() - uploadStartTime,
        result: 'failure',
        method: 'unknown',
        errorCategory: categorizeUploadError(error),
        importType,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setFileName(null);
    setFilePreview([]);
    setUploadResult(null);
    setUploadProgress(0);
    setProgressMessage('');
    setColumnValidation(null);
    setRowEstimate(null);
  };

  const handleImportTypeChange = (nextType: UploadImportType) => {
    if (nextType === importType) {
      return;
    }

    setImportType(nextType);
    handleReset();
  };

  const scrollToFormatGuidelines = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    formatGuidelinesRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const previewHeaders = filePreview[0] || [];
  const previewRows = filePreview.slice(1);
  const activePanelId = isExpiryImport ? expiryListPanelId : productCatalogPanelId;

  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-0">
      <Card role="region" aria-label="CSV upload workspace" className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-4 py-4 sm:px-6 sm:py-6">
          <CardTitle>
            <h1 className="text-xl font-semibold font-heading sm:text-2xl">
              {isExpiryImport
                ? 'Expiry List Import (CSV/XLSX/XLS)'
                : 'Product Catalog Upload (CSV/XLSX/XLS)'}
            </h1>
          </CardTitle>
        </CardHeader>

        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div
            className="-mx-1 mb-5 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1"
            role="tablist"
            aria-label="CSV import type"
          >
            <Button
              type="button"
              role="tab"
              id="csv-upload-product-catalog-tab"
              aria-selected={importType === 'product-catalog'}
              aria-controls={productCatalogPanelId}
              onClick={() => handleImportTypeChange('product-catalog')}
              variant={importType === 'product-catalog' ? 'default' : 'neutral'}
              className="min-h-11 shrink-0 px-3 py-2"
            >
              Product Catalog
            </Button>
            <Button
              type="button"
              role="tab"
              id="csv-upload-expiry-list-tab"
              aria-selected={importType === 'expiry-list'}
              aria-controls={expiryListPanelId}
              onClick={() => handleImportTypeChange('expiry-list')}
              variant={importType === 'expiry-list' ? 'default' : 'neutral'}
              className="min-h-11 shrink-0 px-3 py-2"
            >
              Expiry List Import
            </Button>
          </div>

          <div
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={
              isExpiryImport ? 'csv-upload-expiry-list-tab' : 'csv-upload-product-catalog-tab'
            }
          >
            <p className="mb-4 text-semantic-text-secondary">
              {isExpiryImport
                ? 'Upload a CSV, XLSX, or XLS file containing SKU, optional item description, and used-by date data to import expiry list records.'
                : 'Upload a CSV, XLSX, or XLS file containing product information (SKU, Name, Cost, Barcode) to update your product database.'}
            </p>

            <div className="mb-6 p-4 bg-semantic-surface-2 rounded-md border border-hairline">
              <h3 className="text-lg font-medium text-semantic-text-primary mb-2">
                Last uploaded file
              </h3>
              {lastUploadSummary ? (
                <div className="grid gap-1 text-sm text-semantic-text-secondary sm:grid-cols-2">
                  <p className="font-medium text-semantic-text-primary">
                    {lastUploadSummary.fileName}
                  </p>
                  <p>
                    {lastUploadSummary.importType === 'expiry-list'
                      ? 'Expiry list'
                      : 'Product catalog'}
                  </p>
                  <p>Completed</p>
                  <p>
                    {lastUploadSummary.importType === 'expiry-list'
                      ? 'Rows imported'
                      : 'Products imported'}
                    : {lastUploadSummary.importedCount}
                  </p>
                  <p>
                    {lastUploadSummary.importType === 'expiry-list'
                      ? 'Rows merged'
                      : 'Products updated'}
                    : {lastUploadSummary.updatedCount}
                  </p>
                  <p>Rows rejected: {lastUploadSummary.rejectedCount}</p>
                </div>
              ) : (
                <p className="text-sm text-semantic-text-secondary">No completed uploads yet.</p>
              )}
            </div>

            {/* Column name and format guidelines */}
            <div
              id={formatGuidelinesId}
              ref={formatGuidelinesRef}
              className="mb-6 scroll-mt-4 p-4 bg-semantic-primary-muted rounded-md"
            >
              <h3 className="text-lg font-medium text-semantic-primary-muted-foreground mb-2">
                Format Guidelines
              </h3>
              {isExpiryImport ? (
                <ul className="list-disc pl-5 space-y-1 text-sm text-semantic-primary-muted-foreground">
                  <li>
                    Required columns:{' '}
                    <code className="bg-semantic-primary-muted px-1 rounded">SKU</code>,{' '}
                    <code className="bg-semantic-primary-muted px-1 rounded">Used-By Date</code>
                  </li>
                  <li>
                    Optional columns:{' '}
                    <code className="bg-semantic-primary-muted px-1 rounded">Item Description</code>
                    , <code className="bg-semantic-primary-muted px-1 rounded">Department</code>
                  </li>
                  <li>
                    Accepted date formats:{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">dd/mm/yy</code>,{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">dd/mm/yyyy</code>,{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">mm/yy</code>,{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">mm/yyyy</code>,{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">mm-yy</code>,{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">mm-yyyy</code>
                  </li>
                  <li>
                    Rejected examples:{' '}
                    <code className="bg-semantic-critical-muted px-1 rounded">12/12</code>{' '}
                    (ambiguous),{' '}
                    <code className="bg-semantic-critical-muted px-1 rounded">Dec/2026</code> (month
                    names unsupported)
                  </li>
                </ul>
              ) : (
                <ul className="list-disc pl-5 space-y-1 text-sm text-semantic-primary-muted-foreground">
                  <li>
                    Required columns: SKU, Name, Cost, Barcode{' '}
                    <span className="text-xs">
                      (<code className="bg-semantic-primary-muted px-1 rounded">SKU</code>,{' '}
                      <code className="bg-semantic-primary-muted px-1 rounded">Name</code>,{' '}
                      <code className="bg-semantic-primary-muted px-1 rounded">Cost</code>,{' '}
                      <code className="bg-semantic-primary-muted px-1 rounded">Barcode</code>)
                    </span>
                  </li>
                  <li>
                    Column names are case-insensitive and can include common variations (e.g.,
                    "Product Name", "Item Name", "Item Cost", "Unit Cost")
                  </li>
                  <li>
                    Cost format: Use decimal numbers like{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">1.99</code> or{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">19.99</code> (no
                    currency symbols)
                  </li>
                </ul>
              )}
            </div>

            {isExpiryImport && (
              <div className="mb-6 p-4 bg-semantic-surface-2 rounded-md border border-hairline">
                <h3 className="text-lg font-medium text-semantic-text-primary mb-2">
                  Download Import Templates
                </h3>
                <p className="text-sm text-semantic-text-secondary mb-3">
                  Templates include required fields, accepted date examples, and rejected-format
                  guidance.
                </p>
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    onClick={() => downloadExpiryTemplate('csv')}
                    size="sm"
                    className="min-h-11 w-full sm:w-auto"
                  >
                    Download CSV Template
                  </Button>
                  <Button
                    type="button"
                    onClick={() => downloadExpiryTemplate('xlsx')}
                    size="sm"
                    className="min-h-11 w-full sm:w-auto"
                  >
                    Download XLSX Template
                  </Button>
                  <Button
                    type="button"
                    onClick={() => downloadExpiryTemplate('xls')}
                    size="sm"
                    className="min-h-11 w-full sm:w-auto"
                  >
                    Download XLS Template
                  </Button>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} aria-busy={isUploading}>
              <div className="mb-4">
                <label
                  htmlFor={fileInputId}
                  className="block text-sm font-medium text-semantic-text-secondary mb-2"
                >
                  CSV/XLSX/XLS File
                </label>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <Input
                    id={fileInputId}
                    type="file"
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel"
                    onChange={handleFileChange}
                    className="block h-auto min-h-11 w-full py-2 text-sm text-semantic-text-tertiary
                  cursor-pointer
                  file:mr-4 file:min-h-11 file:px-4 file:py-2
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-semantic-primary-muted file:text-semantic-primary-muted-foreground
                  file:cursor-pointer
                  hover:file:bg-semantic-primary-muted"
                  />
                  {fileName && (
                    <span className="min-w-0 max-w-full truncate text-sm text-semantic-text-secondary sm:max-w-xs">
                      {fileName}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-semantic-text-tertiary">
                  {isExpiryImport
                    ? 'The file should include SKU and Used-By Date columns. When the Department column is omitted, items are assigned to Unallocated.'
                    : 'The CSV/XLSX/XLS file should contain columns: SKU, Name, Cost, and Barcode (in that order).'}
                </p>
              </div>

              {filePreview.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h3>
                  <div
                    className="overflow-x-auto rounded-md border border-hairline"
                    role="region"
                    aria-label="File preview"
                    tabIndex={0}
                  >
                    <Table className="min-w-max">
                      <TableHeader>
                        <TableRow>
                          {previewHeaders.map((header, index) => (
                            <TableHead
                              key={`${header}-${index}`}
                              className="text-left text-xs font-medium text-semantic-text-secondary uppercase tracking-wider"
                            >
                              {header || `Column ${index + 1}`}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {previewHeaders.map((_, cellIndex) => (
                              <TableCell
                                key={cellIndex}
                                className="whitespace-nowrap text-sm text-semantic-text-primary"
                              >
                                {row[cellIndex] || ''}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Column validation warning */}
              {columnValidation && !columnValidation.isValid && (
                <div
                  role="alert"
                  className="mb-4 p-4 bg-semantic-warning-muted border border-semantic-warning-muted rounded-md"
                >
                  <h4 className="font-semibold text-semantic-warning-muted-foreground mb-2">
                    Column validation warning
                  </h4>
                  <div className="text-sm text-semantic-warning-muted-foreground whitespace-pre-line">
                    {formatColumnValidationError(columnValidation)}
                  </div>
                  <p className="text-xs text-semantic-warning mt-2">
                    Upload will be blocked until column names are corrected.
                  </p>
                </div>
              )}

              {/* Column Validation Success */}
              {columnValidation && columnValidation.isValid && selectedFile && (
                <div
                  role="status"
                  className="mb-4 p-3 bg-semantic-success-muted border border-semantic-success-muted rounded-md"
                >
                  <p className="text-sm text-semantic-success-muted-foreground">
                    All required columns found:{' '}
                    {Object.values(columnValidation.foundColumns).join(', ')}
                  </p>
                </div>
              )}

              {/* Row Estimate Warning */}
              {rowEstimate && rowEstimate.showWarning && (
                <div
                  role="status"
                  className="mb-4 p-4 bg-semantic-secondary-muted border border-semantic-secondary-muted rounded-md"
                >
                  <h4 className="font-semibold text-semantic-secondary-muted-foreground mb-1">
                    Large file detected
                  </h4>
                  <p className="text-sm text-semantic-secondary-muted-foreground">
                    {rowEstimate.warningMessage}
                  </p>
                  <p className="text-xs text-semantic-secondary mt-1">
                    The upload will proceed normally, but please be patient during processing.
                  </p>
                </div>
              )}

              {isUploading && (
                <div className="mb-4" role="status" aria-label="Upload status" aria-live="polite">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-semantic-text-secondary">
                      {progressMessage}
                    </span>
                    <span className="text-sm font-medium text-semantic-text-secondary">
                      {uploadProgress}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                    className="w-full overflow-hidden bg-semantic-surface-3 rounded-full h-2.5"
                  >
                    <div
                      className="h-2.5 w-full origin-left rounded-full bg-semantic-primary transition-transform duration-300 ease-out"
                      style={{ transform: `scaleX(${uploadProgress / 100})` }}
                    ></div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:flex sm:items-center sm:gap-4">
                <Button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="min-h-11 w-full px-4 py-2 font-medium sm:w-auto"
                >
                  {isUploading
                    ? 'Uploading'
                    : isExpiryImport
                      ? 'Upload Expiry List'
                      : 'Upload CSV/XLSX/XLS'}
                </Button>

                <Button
                  type="button"
                  onClick={handleReset}
                  variant="neutral"
                  className="min-h-11 w-full px-4 py-2 sm:w-auto"
                >
                  Reset
                </Button>
              </div>
            </form>

            {uploadResult && (
              <div
                role={uploadResult.success ? 'status' : 'alert'}
                className={`mt-6 p-4 rounded-md ${uploadResult.success ? 'bg-semantic-success-muted text-semantic-success-muted-foreground' : 'bg-semantic-critical-muted text-semantic-critical-muted-foreground'}`}
              >
                <h3 className="font-semibold mb-2">
                  {uploadResult.success ? 'Upload successful' : 'Upload failed'}
                </h3>

                <p>{uploadResult.message}</p>

                {(uploadResult.importedCount !== undefined ||
                  uploadResult.processedCount !== undefined) && (
                  <div className="mt-2">
                    {uploadResult.importedCount !== undefined && (
                      <p>
                        {isExpiryImport ? 'Rows imported' : 'Products imported'}:{' '}
                        {uploadResult.importedCount}
                      </p>
                    )}
                    {isExpiryImport ? (
                      <p>
                        Rows merged: {uploadResult.mergedCount ?? uploadResult.updatedCount ?? 0}
                      </p>
                    ) : (
                      uploadResult.updatedCount !== undefined && (
                        <p>Products updated: {uploadResult.updatedCount}</p>
                      )
                    )}
                    {uploadResult.errorCount !== undefined && (
                      <p>Errors: {uploadResult.errorCount}</p>
                    )}
                    {(uploadResult.rejectedCount !== undefined ||
                      uploadResult.skippedCount !== undefined) && (
                      <p>
                        {isExpiryImport ? 'Rows rejected' : 'Rows skipped'}:{' '}
                        {uploadResult.rejectedCount ?? uploadResult.skippedCount ?? 0}
                      </p>
                    )}
                    {uploadResult.processedCount !== undefined && (
                      <p>
                        Rows processed: {uploadResult.processedCount}
                        {uploadResult.totalCount !== undefined
                          ? ` / ${uploadResult.totalCount}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}

                {isExpiryImport &&
                  uploadResult.rejectedRows &&
                  uploadResult.rejectedRows.length > 0 && (
                    <div className="mt-3 p-3 bg-semantic-surface-1 bg-opacity-60 rounded border border-semantic-critical-muted">
                      <p className="text-sm font-medium mb-2">Rejected rows</p>
                      <div className="space-y-2">
                        {uploadResult.rejectedRows.map((row) => (
                          <div key={`${row.rowNumber}-${row.reason}`} className="text-sm">
                            <p className="font-medium">
                              Row {row.rowNumber}: {row.reason}
                            </p>
                            <p className="text-xs opacity-90">
                              SKU: {row.rawValues.sku || '-'} | Item Description:{' '}
                              {row.rawValues.itemDescription || '-'} | Used-By Date:{' '}
                              {row.rawValues.usedByDate || '-'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Column Usage Summary */}
                {uploadResult.columnsUsed && uploadResult.columnsUsed.length > 0 && (
                  <div className="mt-3 p-3 bg-semantic-surface-1 bg-opacity-50 rounded border border-semantic-success-muted">
                    <p className="text-sm font-medium">Column summary</p>
                    <p className="text-sm">
                      Used: <span className="font-mono">{uploadResult.columnsUsed.join(', ')}</span>
                    </p>
                    {uploadResult.columnsIgnored !== undefined &&
                      uploadResult.columnsIgnored > 0 && (
                        <p className="text-sm text-semantic-success-muted-foreground">
                          Ignored {uploadResult.columnsIgnored} extra column
                          {uploadResult.columnsIgnored > 1 ? 's' : ''}
                        </p>
                      )}
                  </div>
                )}

                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <div className="mt-2">
                    <h4 className="font-semibold mt-3">Error details:</h4>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {uploadResult.errors.map((error, index) => (
                        <li key={index} className="text-sm">
                          {error.includes('column') && error.toLowerCase().includes('name') ? (
                            <span>
                              {error} -{' '}
                              <button
                                type="button"
                                className="cursor-pointer text-semantic-primary hover:underline"
                                onClick={scrollToFormatGuidelines}
                                aria-controls={formatGuidelinesId}
                              >
                                See format guidelines
                              </button>
                            </span>
                          ) : error.includes('cost') && error.toLowerCase().includes('format') ? (
                            <span>
                              {error} -{' '}
                              <button
                                type="button"
                                className="cursor-pointer text-semantic-primary hover:underline"
                                onClick={scrollToFormatGuidelines}
                                aria-controls={formatGuidelinesId}
                              >
                                See cost format guidelines
                              </button>
                            </span>
                          ) : (
                            <span>{error}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {uploadResult.success &&
                  typeof returnUrl === 'string' &&
                  returnUrl.startsWith('/') &&
                  !returnUrl.startsWith('//') &&
                  !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(returnUrl) && (
                    <div className="mt-6 pt-4 border-t border-semantic-success-muted">
                      <Button
                        type="button"
                        onClick={() => navigate(returnUrl)}
                        variant="success"
                        className="w-full py-2 font-semibold"
                      >
                        Continue to next step
                      </Button>
                    </div>
                  )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CSVUploadPage;
