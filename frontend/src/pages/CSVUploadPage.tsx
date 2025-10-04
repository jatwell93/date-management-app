import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

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
  const navigate = useNavigate();

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
        const previewData = lines.map(line => line.split(',').map(cell => cell.trim()));
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
        message: 'Please select a CSV, XLSX, or XLS file to upload'
      });
      return;
    }

    // Validate file type
    if (selectedFile.type !== 'text/csv' &&
      selectedFile.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      selectedFile.type !== 'application/vnd.ms-excel' &&
      !selectedFile.name.endsWith('.csv') &&
      !selectedFile.name.endsWith('.xlsx') &&
      !selectedFile.name.endsWith('.xls')) {
      setUploadResult({
        success: false,
        message: 'Please select a valid CSV, XLSX, or XLS file'
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setProgressMessage('Starting upload...');
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
        setProgressMessage('Uploading...');
      }, 200);

      const response = await fetch(`${process.env.REACT_APP_API_URL}/products/upload-csv`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);
      setProgressMessage('Processing...');

      const result: UploadResponse = await response.json();

      if (response.ok) {
        setUploadResult(result);
        setUploadProgress(0);
        setProgressMessage('');
      } else {
        setUploadResult({
          success: false,
          message: result.message || 'An error occurred during upload',
          errors: result.errors
        });
      }
    } catch (error) {
      setUploadResult({
        success: false,
        message: 'Network error: Unable to connect to the server'
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
          Upload a CSV, XLSX, or XLS file containing product information (SKU, Name, Cost, Barcode) to update your product database.
        </p>

        {/* Column name and format guidelines */}
        <div className="mb-6 p-4 bg-blue-50 rounded-md">
          <h3 className="text-lg font-medium text-blue-800 mb-2">Format Guidelines</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-blue-700">
            <li>Required columns: <code className="bg-blue-100 px-1 rounded">SKU</code>, <code className="bg-blue-100 px-1 rounded">Name</code>, <code className="bg-blue-100 px-1 rounded">Cost</code>, <code className="bg-blue-100 px-1 rounded">Barcode</code></li>
            <li>Column names are case-insensitive and can include common variations (e.g., "Product Name", "Item Name", "Item Cost", "Unit Cost")</li>
            <li>Cost format: Use decimal numbers like <code className="bg-blue-100 px-1 rounded">1.99</code> or <code className="bg-blue-100 px-1 rounded">19.99</code> (no currency symbols)</li>
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
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              {fileName && (
                <span className="ml-4 text-sm text-gray-600 truncate max-w-xs">
                  {fileName}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-500">
              The CSV/XLSX/XLS file should contain columns: SKU, Name, Cost, and Barcode (in that order)
            </p>
          </div>

          {filePreview.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">File Preview (First 5 rows):</h3>
              <div className="overflow-x-auto border rounded-md">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Barcode</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filePreview.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? 'bg-gray-100 font-semibold' : ''}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out"
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
                  : 'bg-blue-600 hover:bg-blue-700'
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
          <div className={`mt-6 p-4 rounded-md ${uploadResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
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
                        <span>{error} - <a
                          href="#"
                          className="text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            document.querySelector('h3.text-lg.font-medium.text-blue-800')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          See format guidelines
                        </a></span>
                      ) : error.includes('cost') && error.toLowerCase().includes('format') ? (
                        <span>{error} - <a
                          href="#"
                          className="text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            document.querySelector('h3.text-lg.font-medium.text-blue-800')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          See cost format guidelines
                        </a></span>
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