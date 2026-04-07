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
} from '../utils/csvValidator';
import { buildApiUrl } from '../lib/api.service';

interface UploadResponse {
  success: boolean;
  message: string;
  importedCount?: number;
  updatedCount?: number;
  errorCount?: number;
  skippedCount?: number;
  processedCount?: number;
  totalCount?: number;
  errors?: string[];
  columnsUsed?: string[];
  columnsIgnored?: number;
}

export const CSVUploadPage: React.FC<{ token: string | null }> = ({ token }) => {
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
        const validation = await validateCSVColumns(file);
        setColumnValidation(validation);
      } catch (error) {
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
          throw new Error('Failed to get upload status');
        }

        const statusData = await statusRes.json();

        if (statusData.status === 'complete') {
          setUploadResult({
            success: true,
            message: 'File uploaded and processed successfully',
            importedCount: statusData.importedCount,
            updatedCount: statusData.updatedCount,
            errorCount: statusData.errorCount,
            skippedCount: statusData.skippedCount,
            processedCount: statusData.rowsProcessed,
            totalCount: statusData.rowsTotal,
            columnsUsed: statusData.columnsUsed,
            columnsIgnored: statusData.columnsIgnored,
          });
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
        // Continue polling on error
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

          // Use key in the URL path: /upload/direct/:key
          const directUrl = uploadUrl.startsWith('http')
            ? `${uploadUrl}/${encodeURIComponent(key)}`
            : `${uploadBaseUrl}/direct/${encodeURIComponent(key)}`;

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
          body: JSON.stringify({ key: uploadKey }),
        });

        if (!completeRes.ok) throw new Error('Processing failed');
      }

      // Poll for processing completion
      await pollUploadStatus(uploadKey);

      logUploadMetric('upload_complete', {
        fileSize: fileToUpload.size,
        durationMs: Date.now() - uploadStartTime,
        result: 'success',
        method: strategy,
        fileType: fileToUpload.type,
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

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Product Upload (CSV/XLSX/XLS)</h1>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="mb-4 text-gray-700">
          Upload a CSV, XLSX, or XLS file containing product information (SKU, Name, Cost, Barcode)
          to update your product database.
        </p>

        {/* Column name and format guidelines */}
        <div className="mb-6 p-4 bg-inventory-primary-50 rounded-md">
          <h3 className="text-lg font-medium text-inventory-primary-800 mb-2">Format Guidelines</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-inventory-primary-700">
            <li>
              Required columns: <code className="bg-inventory-primary-100 px-1 rounded">SKU</code>,{' '}
              <code className="bg-inventory-primary-100 px-1 rounded">Name</code>,{' '}
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
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              CSV/XLSX/XLS File
            </label>
            <div className="flex items-center">
              <input
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
              The CSV/XLSX/XLS file should contain columns: SKU, Name, Cost, and Barcode (in that
              order)
            </p>
          </div>

          {filePreview.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h3>
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        SKU
                      </TableHead>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Name
                      </TableHead>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Cost
                      </TableHead>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Barcode
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filePreview.map((row, rowIndex) => (
                      <TableRow
                        key={rowIndex}
                        className={rowIndex === 0 ? 'bg-muted font-semibold' : ''}
                      >
                        {row.map((cell, cellIndex) => (
                          <TableCell
                            key={cellIndex}
                            className="whitespace-nowrap text-sm text-foreground"
                          >
                            {cell}
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
              className={`px-4 py-2 rounded-md text-white font-medium ${isUploading || !selectedFile
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-inventory-primary-600 hover:bg-inventory-primary-700'
                }`}
            >
              {isUploading ? 'Uploading...' : 'Upload CSV/XLSX/XLS'}
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
                    <p>Products imported: {uploadResult.importedCount}</p>
                  )}
                  {uploadResult.updatedCount !== undefined && (
                    <p>Products updated: {uploadResult.updatedCount}</p>
                  )}
                  {uploadResult.errorCount !== undefined && <p>Errors: {uploadResult.errorCount}</p>}
                  {uploadResult.skippedCount !== undefined && (
                    <p>Rows skipped: {uploadResult.skippedCount}</p>
                  )}
                  {uploadResult.processedCount !== undefined && (
                    <p>
                      Rows processed: {uploadResult.processedCount}
                      {uploadResult.totalCount !== undefined ? ` / ${uploadResult.totalCount}` : ''}
                    </p>
                  )}
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
