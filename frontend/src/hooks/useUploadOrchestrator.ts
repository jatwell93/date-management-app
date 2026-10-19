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
import { type UploadRun, useUploadRuns } from './useUploadRuns';

const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INITIAL_INTERVAL_MS = 1000;
const POLL_MAX_INTERVAL_MS = 15000;
export const UPLOAD_CANCELLED_MESSAGE =
  'Upload cancelled before the server accepted the file. You can upload it again.';
export const HANDED_OFF_CANCEL_MESSAGE =
  'Stopped waiting for this upload. The server already accepted the file and will finish importing it, but the result will not appear under "Last uploaded file". Wait a few minutes before uploading another catalogue.';
export const ACTIVE_IMPORT_MESSAGE =
  'Another catalogue import is still running for this store. Wait for it to finish, then upload again.';

const cancelMessage = (cancelled: { handedOff: boolean } | null) =>
  cancelled?.handedOff ? HANDED_OFF_CANCEL_MESSAGE : UPLOAD_CANCELLED_MESSAGE;

// 409 means the server is still importing an earlier file (often one the user just cancelled).
const requestFailure = (res: Response, fallback: string) =>
  new Error(res.status === 409 ? ACTIVE_IMPORT_MESSAGE : fallback);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextPollInterval = (interval: number) =>
  Math.min(Math.ceil(interval * 1.5), POLL_MAX_INTERVAL_MS);

class CancelledRunError extends Error {}

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

const UNREADABLE_RESPONSE_MESSAGE =
  'The server sent an unreadable response. Please try the upload again.';

// Proxy and edge error pages can arrive as 200 HTML; never surface a raw JSON SyntaxError.
async function readJsonBody<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(UNREADABLE_RESPONSE_MESSAGE);
  }
}

// Storage can be blocked (private mode, managed devices); the summary is a convenience only.
function readStoredSummary(): LastUploadSummary | null {
  try {
    const storedSummary = localStorage.getItem(LAST_UPLOAD_SUMMARY_KEY);
    return storedSummary ? (JSON.parse(storedSummary) as LastUploadSummary) : null;
  } catch {
    try {
      localStorage.removeItem(LAST_UPLOAD_SUMMARY_KEY);
    } catch {
      // Storage unavailable; nothing to clear.
    }
    return null;
  }
}

function storeSummary(summary: LastUploadSummary): void {
  try {
    localStorage.setItem(LAST_UPLOAD_SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // Storage unavailable; the in-memory summary still shows for this session.
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
  const [lastUploadSummary, setLastUploadSummary] = useState<LastUploadSummary | null>(
    readStoredSummary,
  );

  const runs = useUploadRuns();

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
      storeSummary(summary);
    },
    [],
  );

  // One status request. Resolves true when polling should stop (terminal state or a
  // cancelled run), false to keep polling; throws on errors.
  const pollOnce = useCallback(
    async (
      key: string,
      completedFileName: string,
      completedImportType: UploadImportType,
      run: UploadRun,
    ): Promise<boolean> => {
      const authHeaders = await getUploadAuthHeaders();
      const statusRes = await fetch(buildApiUrl(`/upload/status/${encodeURIComponent(key)}`), {
        headers: authHeaders,
        signal: run.signal,
      });
      if (!run.isCurrent()) return true;
      if (!statusRes.ok) await throwForPollError(statusRes);

      const statusData = await statusRes.json();
      if (!run.isCurrent()) return true;

      if (TERMINAL_STATUSES.has(statusData.status)) {
        recordCompletedUpload(
          toUploadResultFromSummary(statusData),
          completedFileName,
          completedImportType,
        );
        return true;
      }

      if (statusData.status === 'failed') {
        setUploadResult({
          success: false,
          message: statusData.message || statusData.error || 'Processing failed',
        });
        return true;
      }

      setUploadProgress(statusData.progress || 0);
      setProgressMessage(statusData.message || 'Processing file');
      return false;
    },
    [getUploadAuthHeaders, recordCompletedUpload],
  );

  const pollUploadStatus = useCallback(
    async (
      key: string,
      completedFileName: string,
      completedImportType: UploadImportType,
      run: UploadRun,
    ) => {
      const timeoutAt = Date.now() + POLL_TIMEOUT_MS;
      let pollInterval = POLL_INITIAL_INTERVAL_MS;

      while (Date.now() < timeoutAt) {
        if (!run.isCurrent()) return;
        try {
          if (await pollOnce(key, completedFileName, completedImportType, run)) return;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Processing failed')) {
            throw error;
          }
          // Transient error (network, 5xx, 429): back off below instead of retrying at once.
        }
        await sleep(pollInterval);
        pollInterval = nextPollInterval(pollInterval);
      }

      if (run.isCurrent()) {
        setUploadResult({
          success: false,
          message: 'Processing timed out. Please check your uploads.',
        });
      }
    },
    [pollOnce],
  );

  const initiateUpload = useCallback(
    async (
      fileNameToUpload: string,
      fileToUpload: File,
      uploadImportType: UploadImportType,
      uploadBaseUrl: string,
      signal: AbortSignal,
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
        signal,
      });

      if (!initiateRes.ok) throw requestFailure(initiateRes, 'Failed to initiate upload');

      return readJsonBody(initiateRes);
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
      signal: AbortSignal,
    ): Promise<{ uploadKey: string; directCompletionData?: Record<string, unknown> }> => {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 500);
      // Stop ticking the moment the run is cancelled; otherwise a stale timer (e.g. during a
      // retry backoff) keeps bumping the progress of the next upload.
      signal.addEventListener('abort', () => clearInterval(progressInterval), { once: true });

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
            signal,
          });

          if (!directRes.ok) throw requestFailure(directRes, 'Direct upload failed');

          const directData = await readJsonBody<Record<string, unknown>>(directRes);
          const uploadKey = (directData.key as string | undefined) || initiateKey;

          return { uploadKey, directCompletionData: directData };
        } else {
          const putRes = await uploadWithRetry(uploadUrl, {
            method: method,
            headers: { 'Content-Type': fileToUpload.type },
            body: fileToUpload,
            signal,
          });
          if (!putRes.ok) throw requestFailure(putRes, 'Upload failed after multiple attempts');

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
      signal: AbortSignal,
    ): Promise<Record<string, unknown>> => {
      const authHeaders = await getUploadAuthHeaders();
      const completeRes = await fetch(`${uploadBaseUrl}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ key: uploadKey, importType: uploadImportType }),
        signal,
      });

      if (!completeRes.ok) throw requestFailure(completeRes, 'Processing failed');

      return readJsonBody(completeRes);
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

      const run = runs.begin();
      const isCurrent = run.isCurrent;
      const assertCurrent = () => {
        if (!isCurrent()) throw new CancelledRunError();
      };

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
        assertCurrent();

        setProgressMessage('Starting upload');
        const { strategy, uploadUrl, method, key } = await initiateUpload(
          fileNameToUpload,
          fileToUpload,
          importType,
          uploadBaseUrl,
          run.signal,
        );
        assertCurrent();

        setProgressMessage('Uploading file');
        const { uploadKey, directCompletionData } = await executeUpload(
          strategy,
          uploadUrl,
          method,
          fileToUpload,
          importType,
          uploadBaseUrl,
          key,
          run.signal,
        );
        assertCurrent();
        // A direct upload has now been queued server-side; it imports even if we stop watching.
        if (strategy === 'direct') run.markHandedOff();

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
          const completeData = await completeUpload(
            uploadKey,
            importType,
            uploadBaseUrl,
            run.signal,
          );
          assertCurrent();
          run.markHandedOff();

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

        await pollUploadStatus(uploadKey, file.name, importType, run);
        assertCurrent();

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
        // A cancelled or reset run ends quietly; the newer state already owns the UI.
        if (error instanceof CancelledRunError || !isCurrent()) return;
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
        if (isCurrent()) setIsUploading(false);
      }
    },
    [
      importType,
      runs,
      initiateUpload,
      executeUpload,
      completeUpload,
      pollUploadStatus,
      recordCompletedUpload,
    ],
  );

  const clearRunState = useCallback((result: UploadResponse | null) => {
    setIsUploading(false);
    setUploadResult(result);
    setUploadProgress(0);
    setProgressMessage('');
  }, []);

  const resetUploadState = useCallback(() => {
    runs.supersede();
    clearRunState(null);
  }, [runs, clearRunState]);

  // Aborts the run's in-flight requests and unlocks the form. A file the server already
  // accepted keeps importing there; the message says so instead of implying it stopped.
  const cancelUpload = useCallback(() => {
    clearRunState({ success: false, message: cancelMessage(runs.supersede()) });
  }, [runs, clearRunState]);

  const downloadErrorReport = useCallback(
    async (reportUrl: string): Promise<boolean> => {
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
        return true;
      } catch (error) {
        console.error('Failed to download the error report', error);
        return false;
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
    cancelUpload,
    downloadErrorReport,
  };
}
