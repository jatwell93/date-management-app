import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { StorageProvider } from '../storage/storage-provider.interface';
import { CSVParserService } from './csv-parser.service';
import { envConfig } from '../config/environment';

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
  async completeUpload(key: string): Promise<void> {
    // 1. Verify file exists in storage
    const exists = await this.storage.exists(key);
    if (!exists) {
      throw new Error('File upload verification failed: File not found in storage');
    }

    // 2. Download to temp file
    // CsvParserService requires a file path currently.
    // In the future, we should refactor it to accept a stream.
    const buffer = await this.storage.download(key);
    const tempPath = path.join(os.tmpdir(), path.basename(key));

    try {
      await fs.writeFile(tempPath, buffer);

      // 3. Process file
      await this.csvParser.processFile(tempPath);
    } finally {
      // 4. Cleanup temp file
      try {
        await fs.unlink(tempPath);
      } catch (err) {
        // Ignore parsing errors? No, we want to bubble them up.
        // But we MUST cleanup.
        console.error(`Failed to cleanup temp file ${tempPath}`, err);
      }
    }
  }

  /**
   * Handle direct file upload (from controller)
   */
  async handleDirectUpload(buffer: Buffer, filename: string, contentType: string): Promise<string> {
    const timestamp = Date.now();
    const key = `uploads/${timestamp}-${path.basename(filename)}`;

    // 1. Upload to storage (this works for both Local and R2)
    // If we want to skip R2 for direct uploads and just use temp file, we can.
    // But keeping it in storage is better for consistency (backup/audit).
    await this.storage.upload(key, buffer, contentType);

    // 2. Trigger processing
    await this.completeUpload(key);

    return key;
  }
}
