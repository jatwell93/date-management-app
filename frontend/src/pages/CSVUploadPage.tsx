import React, { useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import * as XLSX from 'xlsx';
import { downloadExpiryTemplate, downloadCatalogTemplate } from '../utils/uploadUtils';
import { useUploadOrchestrator } from '../hooks/useUploadOrchestrator';

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string[][]>([]);
  const [columnValidation, setColumnValidation] = useState<ColumnValidationResult | null>(null);
  const [rowEstimate, setRowEstimate] = useState<RowEstimate | null>(null);

  const {
    isUploading,
    uploadResult,
    uploadProgress,
    progressMessage,
    lastUploadSummary,
    submitUpload,
    resetUploadState,
    downloadErrorReport,
  } = useUploadOrchestrator({ token, importType });

  const isExpiryImport = importType === 'expiry-list';

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file);
      setFileName(file.name);
      setColumnValidation(null);
      setRowEstimate(null);
      resetUploadState();

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

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submitUpload({ file: selectedFile, columnValidation });
  };

  const handleReset = () => {
    setSelectedFile(null);
    setFileName(null);
    setFilePreview([]);
    setColumnValidation(null);
    setRowEstimate(null);
    resetUploadState();
  };

  const handleImportTypeChange = (nextType: UploadImportType) => {
    if (nextType === importType) {
      return;
    }

    setImportType(nextType);
    handleReset();
  };

  const scrollToFormatGuidelines = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
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
              aria-controls={importType === 'product-catalog' ? productCatalogPanelId : undefined}
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
              aria-controls={importType === 'expiry-list' ? expiryListPanelId : undefined}
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
                : 'Upload a CSV, XLSX, or XLS file containing product information (SKU, Name, Cost, Barcode, and optional Retail Price) to update your product database.'}
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
                    Optional column:{' '}
                    <code className="bg-semantic-primary-muted px-1 rounded">Retail Price</code>{' '}
                    (also accepts "Selling Price", "Sell Price", "RRP", "Sale Price") — enables
                    retail-based markdown bands
                  </li>
                  <li>
                    Column names are case-insensitive and can include common variations (e.g.,
                    "Product Name", "Item Name", "Item Cost", "Unit Cost")
                  </li>
                  <li>
                    Cost and Retail format: Use decimal numbers like{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">1.99</code> or{' '}
                    <code className="bg-semantic-secondary-muted px-1 rounded">19.99</code> (no
                    currency symbols)
                  </li>
                </ul>
              )}
            </div>

            <div className="mb-6 p-4 bg-semantic-surface-2 rounded-md border border-hairline">
              <h3 className="text-lg font-medium text-semantic-text-primary mb-2">
                Download Import Templates
              </h3>
              <p className="text-sm text-semantic-text-secondary mb-3">
                {isExpiryImport
                  ? 'Templates include required fields, accepted date examples, and rejected-format guidance.'
                  : 'Templates include the required columns (SKU, Name, Cost, Barcode), the optional Retail Price column, and accepted header variations.'}
              </p>
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button
                  type="button"
                  onClick={() =>
                    isExpiryImport ? downloadExpiryTemplate('csv') : downloadCatalogTemplate('csv')
                  }
                  size="sm"
                  className="min-h-11 w-full sm:w-auto"
                >
                  Download CSV Template
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    isExpiryImport
                      ? downloadExpiryTemplate('xlsx')
                      : downloadCatalogTemplate('xlsx')
                  }
                  size="sm"
                  className="min-h-11 w-full sm:w-auto"
                >
                  Download XLSX Template
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    isExpiryImport ? downloadExpiryTemplate('xls') : downloadCatalogTemplate('xls')
                  }
                  size="sm"
                  className="min-h-11 w-full sm:w-auto"
                >
                  Download XLS Template
                </Button>
              </div>
            </div>

            <form onSubmit={handleFormSubmit} aria-busy={isUploading}>
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
                    : 'The CSV/XLSX/XLS file should contain columns: SKU, Name, Cost, and Barcode, plus an optional Retail Price column.'}
                </p>
              </div>

              {filePreview.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h3>
                  {/* Keyboard users need a focus target to scroll the wide preview table horizontally. */}
                  {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
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
                  {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
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
                      <>
                        {uploadResult.updatedCount !== undefined && (
                          <p>Products updated: {uploadResult.updatedCount}</p>
                        )}
                        {uploadResult.unchangedCount !== undefined && (
                          <p>Products unchanged: {uploadResult.unchangedCount}</p>
                        )}
                      </>
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

                {uploadResult.errorReportUrl && (
                  <button
                    type="button"
                    onClick={() => downloadErrorReport(uploadResult.errorReportUrl as string)}
                    className="mt-3 text-sm font-medium underline text-semantic-link"
                  >
                    Download full error report
                  </button>
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
