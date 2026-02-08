import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { StorageProvider, FileMetadata } from '../storage/storage-provider.interface';
import { CSVParserService } from './csv-parser.service';
import { envConfig } from '../config/environment';
import { StorageQuotaService } from './storage-quota.service';
import { Logger } from '../utils/logger';

export interface InitiateUploadResponse {
  strategy: 'direct' | 'presigned';
  uploadUrl: string;
  method: 'POST' | 'PUT';
  key: string;
}

export class UploadService {
  constructor(
    private storage: StorageProvider,
    private csvParser: CSVParserService,
    private storageQuotaService: StorageQuotaService = new StorageQuotaService(),
  ) {}

  /**
   * Determine upload strategy and generate necessary credentials/URLs
   */
  async initiateUpload(
    filename: string,
    fileSize: number,
    _contentType: string,
  ): Promise<InitiateUploadResponse> {
    // 1. Validate file size logic
    const MAX_SIZE = envConfig.MAX_UPLOAD_SIZE_BYTES || 10 * 1024 * 1024; // Default 10MB
    if (fileSize > MAX_SIZE) {
      throw new Error(`File size exceeds maximum limit of ${MAX_SIZE} bytes`);
    }

    const timestamp = Date.now();
    const key = `uploads/${timestamp}-${path.basename(filename)}`;

    // 2. Determine strategy
    // Use DIRECT if:
    // - Environment is NOT production
    // - OR file size is small (< threshold)
    // - OR storage provider doesn't support presigned URLs
    const DIRECT_THRESHOLD = envConfig.DIRECT_UPLOAD_THRESHOLD_BYTES || 2 * 1024 * 1024; // Default 2MB
    const isProduction = envConfig.NODE_ENV === 'production';
    const isSmallFile = fileSize < DIRECT_THRESHOLD;

    // Check if provider supports presigned URLs (optional method)
    const supportsPresigned = typeof this.storage.getPresignedUploadUrl === 'function';

    if (!isProduction || isSmallFile || !supportsPresigned) {
      return {
        strategy: 'direct',
        uploadUrl: '/api/upload/direct',
        method: 'POST',
        key,
      };
    }

    // 3. Generate Presigned URL
    // We strictly checked supportsPresigned above, but Typescript might need convincing
    if (!this.storage.getPresignedUploadUrl) {
      throw new Error('Storage provider does not support presigned URLs');
    }

    const uploadUrl = await this.storage.getPresignedUploadUrl(key, 3600); // 1 hour expiry

    return {
      strategy: 'presigned',
      uploadUrl,
      method: 'PUT',
      key,
    };
  }

  /**
   * Finalize upload and trigger parsing
   */
  async completeUpload(key: string, userId: number): Promise<void> {
    const startTime = Date.now();
    // 1. Verify file exists in storage
    const exists = await this.storage.exists(key);
    if (!exists) {
      throw new Error('File upload verification failed: File not found in storage');
    }

    let metadata: FileMetadata | undefined;
    if (this.storage.getMetadata) {
      try {
        metadata = await this.storage.getMetadata(key);
      } catch (error) {
        console.warn('Failed to read upload metadata:', error);
      }
    }

    // 2. Download to temp file
    // CsvParserService requires a file path currently.
    // In the future, we should refactor it to accept a stream.
    const buffer = await this.storage.download(key);
    const tempPath = path.join(os.tmpdir(), path.basename(key));

    try {
      await fs.writeFile(tempPath, buffer);

      // Track upload for quota purposes
      await this.storageQuotaService.recordUpload(
        userId,
        key,
        path.basename(key),
        metadata?.size ?? buffer.length,
        metadata?.contentType,
      );

      // 3. Process file
      await this.csvParser.processFile(tempPath, { uploadKey: key, userId });

      Logger.info('Upload processing metrics', {
        uploadKey: key,
        userId,
        fileSize: metadata?.size ?? buffer.length,
        contentType: metadata?.contentType,
        processingDurationMs: Date.now() - startTime,
        status: 'success',
      });
    } catch (error) {
      Logger.warn('Upload processing metrics', {
        uploadKey: key,
        userId,
        fileSize: metadata?.size ?? buffer.length,
        contentType: metadata?.contentType,
        processingDurationMs: Date.now() - startTime,
        status: 'failure',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      // 4. Cleanup temp file
      try {
        await fs.unlink(tempPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'EPERM') {
          console.error('Failed to cleanup temp file', tempPath, err);
        }
      }
    }
  }

  /**
   * Handle direct file upload (from controller)
   */
  async handleDirectUpload(
    buffer: Buffer,
    filename: string,
    contentType: string,
    userId: number,
  ): Promise<string> {
    const startTime = Date.now();
    const timestamp = Date.now();
    const key = `uploads/${timestamp}-${path.basename(filename)}`;

    // 1. Upload to storage (this works for both Local and R2)
    // If we want to skip R2 for direct uploads and just use temp file, we can.
    // But keeping it in storage is better for consistency (backup/audit).
    await this.storage.upload(key, buffer, contentType);

    // 2. Trigger processing
    try {
      await this.completeUpload(key, userId);
      Logger.info('Direct upload metrics', {
        uploadKey: key,
        userId,
        fileSize: buffer.length,
        contentType,
        uploadDurationMs: Date.now() - startTime,
        status: 'success',
      });
    } catch (error) {
      Logger.warn('Direct upload metrics', {
        uploadKey: key,
        userId,
        fileSize: buffer.length,
        contentType,
        uploadDurationMs: Date.now() - startTime,
        status: 'failure',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    return key;
  }
}
