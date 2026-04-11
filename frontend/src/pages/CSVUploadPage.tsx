import React, { useState } from 'react';
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

export const CSVUploadPage: React.FC<{
  token: string | null;
  defaultImportType?: UploadImportType;
}> = ({ token, defaultImportType = 'product-catalog' }) => {
  const fileInputId = 'csv-upload-file-input';
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
      setProgressMessage('Converting spreadsheet to CSV...');
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

  const pollUploadStatus = async (key: string) => {
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
          setUploadResult(toUploadResultFromSummary(statusData));
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
        setProgressMessage(statusData.message || 'Processing...');

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
    setProgressMessage('Preparing file...');
    setUploadResult(null);

    const uploadStartTime = Date.now();

    try {
      const { fileToUpload, fileNameToUpload } = await normalizeUploadFile(file);

      // 1. Initiate Upload
      setProgressMessage('Initiating upload...');
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
      setProgressMessage(
        strategy === 'presigned' ? 'Uploading to Storage (R2)...' : 'Uploading...',
      );

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
            setUploadResult(toUploadResultFromSummary(directData));
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
        setProgressMessage('Processing file...');
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
          setUploadResult(toUploadResultFromSummary(completeData));

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
      await pollUploadStatus(uploadKey);

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

  const previewHeaders = filePreview[0] || [];
  const previewRows = filePreview.slice(1);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        {isExpiryImport ? 'Expiry List Import (CSV/XLSX/XLS)' : 'Product Upload (CSV/XLSX/XLS)'}
      </h1>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleImportTypeChange('product-catalog')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              importType === 'product-catalog'
                ? 'bg-inventory-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Product Upload
          </button>
          <button
            type="button"
            onClick={() => handleImportTypeChange('expiry-list')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              importType === 'expiry-list'
                ? 'bg-inventory-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Expiry List Import
          </button>
        </div>

        <p className="mb-4 text-gray-700">
          {isExpiryImport
            ? 'Upload a CSV, XLSX, or XLS file containing SKU, optional item description, and used-by date data to import expiry list records.'
            : 'Upload a CSV, XLSX, or XLS file containing product information (SKU, Name, Cost, Barcode) to update your product database.'}
        </p>

        {/* Column name and format guidelines */}
        <div className="mb-6 p-4 bg-inventory-primary-50 rounded-md">
          <h3 className="text-lg font-medium text-inventory-primary-800 mb-2">Format Guidelines</h3>
          {isExpiryImport ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-inventory-primary-700">
              <li>
                Required columns: <code className="bg-inventory-primary-100 px-1 rounded">SKU</code>
                , <code className="bg-inventory-primary-100 px-1 rounded">Used-By Date</code>
              </li>
              <li>
                Optional columns:{' '}
                <code className="bg-inventory-primary-100 px-1 rounded">Item Description</code>,{' '}
                <code className="bg-inventory-primary-100 px-1 rounded">Department</code>
              </li>
              <li>
                Accepted date formats: <code className="bg-blue-100 px-1 rounded">dd/mm/yy</code>,{' '}
                <code className="bg-blue-100 px-1 rounded">dd/mm/yyyy</code>,{' '}
                <code className="bg-blue-100 px-1 rounded">mm/yy</code>,{' '}
                <code className="bg-blue-100 px-1 rounded">mm/yyyy</code>,{' '}
                <code className="bg-blue-100 px-1 rounded">mm-yy</code>,{' '}
                <code className="bg-blue-100 px-1 rounded">mm-yyyy</code>
              </li>
              <li>
                Rejected examples: <code className="bg-red-100 px-1 rounded">12/12</code>{' '}
                (ambiguous), <code className="bg-red-100 px-1 rounded">Dec/2026</code> (month names
                unsupported)
              </li>
            </ul>
          ) : (
            <ul className="list-disc pl-5 space-y-1 text-sm text-inventory-primary-700">
              <li>
                Required columns: <code className="bg-inventory-primary-100 px-1 rounded">SKU</code>
                , <code className="bg-inventory-primary-100 px-1 rounded">Name</code>,{' '}
                <code className="bg-inventory-primary-100 px-1 rounded">Cost</code>,{' '}
                <code className="bg-inventory-primary-100 px-1 rounded">Barcode</code>
              </li>
              <li>
                Column names are case-insensitive and can include common variations (e.g., "Product
                Name", "Item Name", "Item Cost", "Unit Cost")
              </li>
              <li>
                Cost format: Use decimal numbers like{' '}
                <code className="bg-blue-100 px-1 rounded">1.99</code> or{' '}
                <code className="bg-blue-100 px-1 rounded">19.99</code> (no currency symbols)
              </li>
            </ul>
          )}
        </div>

        {isExpiryImport && (
          <div className="mb-6 p-4 bg-gray-50 rounded-md border border-gray-200">
            <h3 className="text-lg font-medium text-gray-800 mb-2">Download Import Templates</h3>
            <p className="text-sm text-gray-600 mb-3">
              Templates include required fields, accepted date examples, and rejected-format
              guidance.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadExpiryTemplate('csv')}
                className="px-3 py-2 rounded-md bg-inventory-primary-600 text-white text-sm font-medium hover:bg-inventory-primary-700"
              >
                Download CSV Template
              </button>
              <button
                type="button"
                onClick={() => downloadExpiryTemplate('xlsx')}
                className="px-3 py-2 rounded-md bg-inventory-primary-600 text-white text-sm font-medium hover:bg-inventory-primary-700"
              >
                Download XLSX Template
              </button>
              <button
                type="button"
                onClick={() => downloadExpiryTemplate('xls')}
                className="px-3 py-2 rounded-md bg-inventory-primary-600 text-white text-sm font-medium hover:bg-inventory-primary-700"
              >
                Download XLS Template
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor={fileInputId} className="block text-sm font-medium text-gray-700 mb-2">
              CSV/XLSX/XLS File
            </label>
            <div className="flex items-center">
              <input
                id={fileInputId}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-inventory-primary-50 file:text-inventory-primary-700
                  hover:file:bg-inventory-primary-100"
              />
              {fileName && (
                <span className="ml-4 text-sm text-gray-600 truncate max-w-xs">{fileName}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-500">
              {isExpiryImport
                ? 'The file should include SKU and Used-By Date columns. When the Department column is omitted, items are assigned to Unallocated.'
                : 'The CSV/XLSX/XLS file should contain columns: SKU, Name, Cost, and Barcode (in that order).'}
            </p>
          </div>

          {filePreview.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h3>
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewHeaders.map((header, index) => (
                        <TableHead
                          key={`${header}-${index}`}
                          className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
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
                            className="whitespace-nowrap text-sm text-foreground"
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

          {/* Column Validation Warning */}
          {columnValidation && !columnValidation.isValid && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Column Validation Warning</h4>
              <div className="text-sm text-yellow-700 whitespace-pre-line">
                {formatColumnValidationError(columnValidation)}
              </div>
              <p className="text-xs text-yellow-600 mt-2">
                Upload will be blocked until column names are corrected.
              </p>
            </div>
          )}

          {/* Column Validation Success */}
          {columnValidation && columnValidation.isValid && selectedFile && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">
                ✓ All required columns found:{' '}
                {Object.values(columnValidation.foundColumns).join(', ')}
              </p>
            </div>
          )}

          {/* Row Estimate Warning */}
          {rowEstimate && rowEstimate.showWarning && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h4 className="font-semibold text-blue-800 mb-1">ℹ️ Large File Detected</h4>
              <p className="text-sm text-blue-700">{rowEstimate.warningMessage}</p>
              <p className="text-xs text-blue-600 mt-1">
                The upload will proceed normally, but please be patient during processing.
              </p>
            </div>
          )}

          {isUploading && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">{progressMessage}</span>
                <span className="text-sm font-medium text-gray-700">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-inventory-primary-600 h-2.5 rounded-full transition-all duration-300 ease-in-out"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="flex items-center space-x-4">
            <button
              type="submit"
              disabled={isUploading || !selectedFile}
              className={`px-4 py-2 rounded-md text-white font-medium ${
                isUploading || !selectedFile
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-inventory-primary-600 hover:bg-inventory-primary-700'
              }`}
            >
              {isUploading
                ? 'Uploading...'
                : isExpiryImport
                  ? 'Upload Expiry List'
                  : 'Upload CSV/XLSX/XLS'}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Reset
            </button>
          </div>
        </form>

        {uploadResult && (
          <div
            className={`mt-6 p-4 rounded-md ${uploadResult.success ? 'bg-inventory-success-50 text-inventory-success-800' : 'bg-inventory-error-50 text-inventory-error-800'}`}
          >
            <h3 className="font-bold mb-2">
              {uploadResult.success ? 'Upload Successful!' : 'Upload Failed'}
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
                  <p>Rows merged: {uploadResult.mergedCount ?? uploadResult.updatedCount ?? 0}</p>
                ) : (
                  uploadResult.updatedCount !== undefined && (
                    <p>Products updated: {uploadResult.updatedCount}</p>
                  )
                )}
                {uploadResult.errorCount !== undefined && <p>Errors: {uploadResult.errorCount}</p>}
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
                    {uploadResult.totalCount !== undefined ? ` / ${uploadResult.totalCount}` : ''}
                  </p>
                )}
              </div>
            )}

            {isExpiryImport &&
              uploadResult.rejectedRows &&
              uploadResult.rejectedRows.length > 0 && (
                <div className="mt-3 p-3 bg-white bg-opacity-60 rounded border border-inventory-error-200">
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
              <div className="mt-3 p-3 bg-white bg-opacity-50 rounded border border-inventory-success-200">
                <p className="text-sm font-medium">Column Summary:</p>
                <p className="text-sm">
                  ✓ Used: <span className="font-mono">{uploadResult.columnsUsed.join(', ')}</span>
                </p>
                {uploadResult.columnsIgnored !== undefined && uploadResult.columnsIgnored > 0 && (
                  <p className="text-sm text-inventory-success-700">
                    ℹ️ Ignored {uploadResult.columnsIgnored} extra column
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
                            className="text-inventory-primary-600 hover:underline"
                            onClick={() => {
                              document
                                .querySelector('h3.text-lg.font-medium.text-inventory-primary-800')
                                ?.scrollIntoView({ behavior: 'smooth' });
                            }}
                          >
                            See format guidelines
                          </button>
                        </span>
                      ) : error.includes('cost') && error.toLowerCase().includes('format') ? (
                        <span>
                          {error} -{' '}
                          <button
                            type="button"
                            className="text-inventory-primary-600 hover:underline"
                            onClick={() => {
                              document
                                .querySelector('h3.text-lg.font-medium.text-inventory-primary-800')
                                ?.scrollIntoView({ behavior: 'smooth' });
                            }}
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
          </div>
        )}
      </div>
    </div>
  );
};

export default CSVUploadPage;
