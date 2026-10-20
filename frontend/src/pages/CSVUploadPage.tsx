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
import { withOccurrenceKeys } from '../utils/listKeys';
import { useUploadOrchestrator } from '../hooks/useUploadOrchestrator';
import { UploadResultPanel } from '../components/csv-upload/UploadResultPanel';
import { toSafeReturnPath } from '../components/csv-upload/safeReturnUrl';
import { LastUploadSummaryCard } from '../components/csv-upload/LastUploadSummaryCard';
import { UploadProgress } from '../components/csv-upload/UploadProgress';
import { FormatGuidelines } from '../components/csv-upload/FormatGuidelines';

export const CSVUploadPage: React.FC<{
  token: string | null;
  defaultImportType?: UploadImportType;
}> = ({ token, defaultImportType = 'product-catalog' }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Only same-origin in-app paths survive; see toSafeReturnPath for the rejected forms.
  const returnUrl = toSafeReturnPath(searchParams.get('return'));

  const headingId = 'csv-upload-heading';
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
    cancelUpload,
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
  // CSV headers can repeat or be blank, so key each column by header + occurrence number.
  const previewColumns = withOccurrenceKeys(previewHeaders, (header) => header).map(
    ({ item, key }) => ({ header: item, key }),
  );
  const previewRows = filePreview.slice(1);
  const activePanelId = isExpiryImport ? expiryListPanelId : productCatalogPanelId;

  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-4xl">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-4 py-4 sm:px-6 sm:py-6">
          <CardTitle>
            <h1 id={headingId} className="text-xl font-semibold font-heading sm:text-2xl">
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
              disabled={isUploading}
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
              disabled={isUploading}
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

            <LastUploadSummaryCard
              summary={lastUploadSummary}
              onReviewBrandMatches={() => navigate('/supplier-credits?view=catalogue-review')}
            />

            <FormatGuidelines
              id={formatGuidelinesId}
              ref={formatGuidelinesRef}
              isExpiryImport={isExpiryImport}
            />

            <div className="mb-6 p-4 bg-semantic-surface-2 rounded-md border border-hairline">
              <h2 className="text-lg font-medium text-semantic-text-primary mb-2">
                Download Import Templates
              </h2>
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
                    disabled={isUploading}
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
                  <h2 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h2>
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
                          {previewColumns.map(({ key, header }, index) => (
                            <TableHead
                              key={key}
                              className="text-left text-sm font-medium text-semantic-text-secondary"
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
                  <h3 className="font-semibold text-semantic-warning-muted-foreground mb-2">
                    Column validation warning
                  </h3>
                  <div className="text-sm text-semantic-warning-muted-foreground whitespace-pre-line">
                    {formatColumnValidationError(columnValidation)}
                  </div>
                  <p className="text-sm text-semantic-warning-muted-foreground mt-2">
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
                  <h3 className="font-semibold text-semantic-secondary-muted-foreground mb-1">
                    Large file detected
                  </h3>
                  <p className="text-sm text-semantic-secondary-muted-foreground">
                    {rowEstimate.warningMessage}
                  </p>
                  <p className="text-sm text-semantic-secondary-muted-foreground mt-1">
                    The upload will proceed normally, but please be patient during processing.
                  </p>
                </div>
              )}

              {isUploading && (
                <UploadProgress progress={uploadProgress} message={progressMessage} />
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
                  disabled={isUploading}
                  variant="neutral"
                  className="min-h-11 w-full px-4 py-2 sm:w-auto"
                >
                  Reset
                </Button>

                {isUploading && (
                  <Button
                    type="button"
                    onClick={cancelUpload}
                    variant="outline"
                    className="min-h-11 w-full px-4 py-2 sm:w-auto"
                  >
                    Cancel upload
                  </Button>
                )}
              </div>
            </form>

            {uploadResult && (
              <UploadResultPanel
                uploadResult={uploadResult}
                isExpiryImport={isExpiryImport}
                returnUrl={returnUrl}
                formatGuidelinesId={formatGuidelinesId}
                onShowGuidelines={scrollToFormatGuidelines}
                onDownloadErrorReport={downloadErrorReport}
                onContinue={(url) => navigate(url)}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

export default CSVUploadPage;
