import { useCallback, useState } from 'react';
import * as Sentry from '@sentry/react';
import {
  type ColumnValidationResult,
  type UploadImportType,
  formatColumnValidationError,
} from '../utils/csvValidator';
import { buildApiUrl } from '../lib/api.service';
import {
  type LastUploadSummary,
  type UploadResponse,
  LAST_UPLOAD_SUMMARY_KEY,
} from '../types/upload';
import {
  categorizeUploadError,
  logUploadMetric,
  normalizeUploadFile,
  toUploadResultFromSummary,
  uploadWithRetry,
  validateSelectedFile,
} from '../utils/uploadUtils';
import { useFreshApiToken } from './useFreshApiToken';

const TERMINAL_STATUSES = new Set(['complete', 'completed', 'completed_with_errors']);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

async function extractStatusErrorSuffix(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const msg =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : '';
    return msg ? `: ${msg}` : '';
  } catch {
    return '';
  }
}

function hasImmediateExpiryResult(
  importType: UploadImportType,
  data: Record<string, unknown> | undefined,
): data is Record<string, unknown> {
  return importType === 'expiry-list' && data?.importedCount !== undefined;
}

async function throwForPollError(res: Response): Promise<never> {
  if (NON_RETRYABLE_STATUS_CODES.has(res.status)) {
    const suffix = await extractStatusErrorSuffix(res);
    throw new Error(`Processing failed${suffix}`);
  }
  throw new Error(`Failed to get upload status (HTTP ${res.status})`);
}

export function useUploadOrchestrator({
  token,
  importType,
}: {
  token: string | null;
  importType: UploadImportType;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
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

  const getFreshToken = useFreshApiToken(token);
  const getUploadAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const authToken = await getFreshToken('csv-upload');
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [getFreshToken]);

  const recordCompletedUpload = useCallback(
    (result: UploadResponse, completedFileName: string, completedImportType: UploadImportType) => {
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
    },
    [],
  );

  const pollUploadStatus = useCallback(
    async (key: string, completedFileName: string, completedImportType: UploadImportType) => {
      const timeoutAt = Date.now() + 30 * 60 * 1000;
      let pollInterval = 1000;

      while (Date.now() < timeoutAt) {
        try {
          const encodedKey = encodeURIComponent(key);
          const authHeaders = await getUploadAuthHeaders();
          const statusRes = await fetch(buildApiUrl(`/upload/status/${encodedKey}`), {
            headers: authHeaders,
          });

          if (!statusRes.ok) await throwForPollError(statusRes);

          const statusData = await statusRes.json();

          if (TERMINAL_STATUSES.has(statusData.status)) {
            recordCompletedUpload(
              toUploadResultFromSummary(statusData),
              completedFileName,
              completedImportType,
            );
            return;
          }

          if (statusData.status === 'failed') {
            setUploadResult({
              success: false,
              message: statusData.message || statusData.error || 'Processing failed',
            });
            return;
          }

          setUploadProgress(statusData.progress || 0);
          setProgressMessage(statusData.message || 'Processing file');

          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          pollInterval = Math.min(Math.ceil(pollInterval * 1.5), 15000);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Processing failed')) {
            throw error;
          }
          // Continue polling on transient errors.
        }
      }

      setUploadResult({
        success: false,
        message: 'Processing timed out. Please check your uploads.',
      });
    },
    [getUploadAuthHeaders, recordCompletedUpload],
  );

  const initiateUpload = useCallback(
    async (
      fileNameToUpload: string,
      fileToUpload: File,
      uploadImportType: UploadImportType,
      uploadBaseUrl: string,
    ): Promise<{ strategy: string; uploadUrl: string; method: string; key: string }> => {
      const authHeaders = await getUploadAuthHeaders();
      const initiateRes = await fetch(`${uploadBaseUrl}/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          filename: fileNameToUpload,
          fileSize: fileToUpload.size,
          contentType: fileToUpload.type,
          importType: uploadImportType,
        }),
      });

      if (!initiateRes.ok) {
        throw new Error('Failed to initiate upload');
      }

      return initiateRes.json();
    },
    [getUploadAuthHeaders],
  );

  const executeUpload = useCallback(
    async (
      strategy: string,
      uploadUrl: string,
      method: string,
      fileToUpload: File,
      uploadImportType: UploadImportType,
      uploadBaseUrl: string,
      initiateKey: string,
    ): Promise<{ uploadKey: string; directCompletionData?: Record<string, unknown> }> => {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 500);

      try {
        if (strategy === 'direct') {
          const formData = new FormData();
          formData.append('file', fileToUpload);
          formData.append('importType', uploadImportType);

          const directUrl = new URL(uploadUrl, `${uploadBaseUrl}/`).toString();

          const directRes = await uploadWithRetry(directUrl, {
            method: 'POST',
            headers: await getUploadAuthHeaders(),
            body: formData,
          });

          if (!directRes.ok) {
            throw new Error('Direct upload failed');
          }

          const directData = (await directRes.json()) as Record<string, unknown>;
          const uploadKey = (directData.key as string | undefined) || initiateKey;

          return { uploadKey, directCompletionData: directData };
        } else {
          await uploadWithRetry(uploadUrl, {
            method: method,
            headers: { 'Content-Type': fileToUpload.type },
            body: fileToUpload,
          });

          return { uploadKey: initiateKey };
        }
      } finally {
        clearInterval(progressInterval);
      }
    },
    [getUploadAuthHeaders],
  );

  const completeUpload = useCallback(
    async (
      uploadKey: string,
      uploadImportType: UploadImportType,
      uploadBaseUrl: string,
    ): Promise<Record<string, unknown>> => {
      const authHeaders = await getUploadAuthHeaders();
      const completeRes = await fetch(`${uploadBaseUrl}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ key: uploadKey, importType: uploadImportType }),
      });

      if (!completeRes.ok) throw new Error('Processing failed');

      return completeRes.json();
    },
    [getUploadAuthHeaders],
  );

  const submitUpload = useCallback(
    async ({
      file,
      columnValidation,
    }: {
      file: File | null;
      columnValidation: ColumnValidationResult | null;
    }) => {
      const validationError = validateSelectedFile(file);
      if (validationError) {
        setUploadResult({ success: false, message: validationError });
        return;
      }

      if (columnValidation && !columnValidation.isValid) {
        setUploadResult({
          success: false,
          message: formatColumnValidationError(columnValidation),
        });
        return;
      }

      if (!file) return;

      setIsUploading(true);
      setUploadProgress(0);
      setProgressMessage('Preparing file');
      setUploadResult(null);

      const uploadStartTime = Date.now();
      const uploadBaseUrl = buildApiUrl('/upload');

      try {
        const { fileToUpload, fileNameToUpload } = await normalizeUploadFile(
          file,
          setProgressMessage,
        );

        setProgressMessage('Starting upload');
        const { strategy, uploadUrl, method, key } = await initiateUpload(
          fileNameToUpload,
          fileToUpload,
          importType,
          uploadBaseUrl,
        );

        setProgressMessage('Uploading file');
        const { uploadKey, directCompletionData } = await executeUpload(
          strategy,
          uploadUrl,
          method,
          fileToUpload,
          importType,
          uploadBaseUrl,
          key,
        );

        setUploadProgress(100);

        if (strategy === 'direct' && hasImmediateExpiryResult(importType, directCompletionData)) {
          recordCompletedUpload(
            toUploadResultFromSummary(directCompletionData),
            file.name,
            importType,
          );
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

        if (strategy === 'presigned') {
          setProgressMessage('Processing file');
          const completeData = await completeUpload(uploadKey, importType, uploadBaseUrl);

          if (hasImmediateExpiryResult(importType, completeData)) {
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
    },
    [
      importType,
      initiateUpload,
      executeUpload,
      completeUpload,
      pollUploadStatus,
      recordCompletedUpload,
    ],
  );

  const resetUploadState = useCallback(() => {
    setIsUploading(false);
    setUploadResult(null);
    setUploadProgress(0);
    setProgressMessage('');
  }, []);

  const downloadErrorReport = useCallback(
    async (reportUrl: string) => {
      try {
        const authHeaders = await getUploadAuthHeaders();
        const res = await fetch(buildApiUrl(reportUrl), { headers: authHeaders });
        if (!res.ok) {
          throw new Error(`Failed to download error report (HTTP ${res.status})`);
        }
        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = 'catalogue-import-errors.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);
      } catch (error) {
        console.error('Failed to download the error report', error);
      }
    },
    [getUploadAuthHeaders],
  );

  return {
    isUploading,
    uploadResult,
    uploadProgress,
    progressMessage,
    lastUploadSummary,
    submitUpload,
    resetUploadState,
    downloadErrorReport,
  };
}
