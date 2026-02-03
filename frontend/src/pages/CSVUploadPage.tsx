import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

interface UploadResponse {
  success: boolean;
  message: string;
  importedCount?: number;
  updatedCount?: number;
  errorCount?: number;
  errors?: string[];
}

export const CSVUploadPage: React.FC<{ token: string | null }> = ({ token }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string[][]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file);
      setFileName(file.name);
      setUploadResult(null); // Reset any previous results

      // Generate preview of the first 5 rows
      previewFile(file);
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedFile) {
      setUploadResult({
        success: false,
        message: 'Please select a CSV, XLSX, or XLS file to upload',
      });
      return;
    }

    // Validate file type
    if (
      selectedFile.type !== 'text/csv' &&
      selectedFile.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      selectedFile.type !== 'application/vnd.ms-excel' &&
      !selectedFile.name.endsWith('.csv') &&
      !selectedFile.name.endsWith('.xlsx') &&
      !selectedFile.name.endsWith('.xls')
    ) {
      setUploadResult({
        success: false,
        message: 'Please select a valid CSV, XLSX, or XLS file',
      });
      return;
    }

    // Validate file size (10MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      setUploadResult({
        success: false,
        message: 'File size exceeds 10MB limit',
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setProgressMessage('Preparing file...');
    setUploadResult(null);

    try {
      let fileToUpload = selectedFile;
      let fileNameToUpload = selectedFile.name;

      // Convert XLSX/XLS to CSV if needed
      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();
      if (
        (fileExtension === 'xlsx' || fileExtension === 'xls') &&
        selectedFile.type !== 'text/csv'
      ) {
        setProgressMessage('Converting spreadsheet to CSV...');
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csvContent = XLSX.utils.sheet_to_csv(worksheet);
        fileToUpload = new File([csvContent], selectedFile.name.replace(/\.[^/.]+$/, '.csv'), {
          type: 'text/csv',
        });
        fileNameToUpload = fileToUpload.name;
      }

      // 1. Initiate Upload
      setProgressMessage('Initiating upload...');
      const apiUrl = process.env.REACT_APP_API_URL || '';

      const initiateRes = await fetch(`${apiUrl}/upload/initiate`, {
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

      const uploadWithRetry = async (url: string, options: RequestInit, retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            console.warn(`Upload attempt ${i + 1} failed with status: ${res.status}`);
          } catch (err) {
            console.warn(`Upload attempt ${i + 1} failed:`, err);
          }
          if (i < retries - 1) {
            const delay = 1000 * Math.pow(2, i); // Exponential backoff
            await new Promise((r) => setTimeout(r, delay));
          }
        }
        throw new Error('Upload failed after multiple attempts');
      };

      try {
        if (strategy === 'direct') {
          const formData = new FormData();
          formData.append('file', fileToUpload);

          const directUrl = uploadUrl.startsWith('http') ? uploadUrl : `${apiUrl}/upload/direct`;

          await uploadWithRetry(directUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });
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
      // For direct upload, the server might trigger processing automatically, but our API design
      // in UploadController for 'direct' finishes with json response.
      // AND 'direct' endpoint calls handleDirectUpload which calls completeUpload.
      // So detailed processing happens. But for consistency, 'presigned' NEEDS explicit complete call.
      // 'direct' does NOT need it if the controller handles it.

      // Strategy check:
      // If presigned, we MUST call complete.
      // If direct, the request is already done.

      if (strategy === 'presigned') {
        setProgressMessage('Processing file...');
        const completeRes = await fetch(`${apiUrl}/upload/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key }),
        });

        if (!completeRes.ok) throw new Error('Processing failed');
      }

      // Success
      setUploadResult({
        success: true,
        message: 'File uploaded and processed successfully',
      });
      setUploadProgress(0);
      setProgressMessage('');
    } catch (error) {
      console.error(error);
      setUploadResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred during upload',
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

            {uploadResult.importedCount !== undefined && (
              <div className="mt-2">
                <p>Products imported: {uploadResult.importedCount}</p>
                <p>Products updated: {uploadResult.updatedCount}</p>
                <p>Errors: {uploadResult.errorCount}</p>
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
                          <a
                            href="#"
                            className="text-inventory-primary-600 hover:underline"
                            onClick={(e) => {
                              e.preventDefault();
                              document
                                .querySelector('h3.text-lg.font-medium.text-inventory-primary-800')
                                ?.scrollIntoView({ behavior: 'smooth' });
                            }}
                          >
                            See format guidelines
                          </a>
                        </span>
                      ) : error.includes('cost') && error.toLowerCase().includes('format') ? (
                        <span>
                          {error} -{' '}
                          <a
                            href="#"
                            className="text-inventory-primary-600 hover:underline"
                            onClick={(e) => {
                              e.preventDefault();
                              document
                                .querySelector('h3.text-lg.font-medium.text-inventory-primary-800')
                                ?.scrollIntoView({ behavior: 'smooth' });
                            }}
                          >
                            See cost format guidelines
                          </a>
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
