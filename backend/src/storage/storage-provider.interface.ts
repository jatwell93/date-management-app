/**
 * Storage Provider Interface
 *
 * Unified interface for file storage operations supporting both
 * local filesystem (development) and Cloudflare R2 (production).
 */

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param key - Unique identifier for the file
   * @param data - File content as Buffer
   * @param contentType - MIME type of the file
   * @returns Promise resolving to the storage key
   * @throws FileSizeLimitError if file exceeds size limit
   * @throws StorageProviderError on upload failure
   */
  upload(key: string, data: Buffer, contentType: string): Promise<string>;

  /**
   * Download a file from storage
   * @param key - File identifier
   * @returns Promise resolving to file content as Buffer
   * @throws FileNotFoundError if file doesn't exist
   * @throws StorageProviderError on download failure
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param key - File identifier
   * @returns Promise resolving when deletion is complete
   * @throws FileNotFoundError if file doesn't exist
   * @throws StorageProviderError on deletion failure
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param key - File identifier
   * @returns Promise resolving to true if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>;

  /**
   * Generate a presigned URL for direct upload (R2 only)
   * @param key - File identifier
   * @param expiresIn - URL expiration time in seconds
   * @returns Promise resolving to presigned URL
   * @throws StorageProviderError if presigned URLs not supported
   */
  getPresignedUploadUrl?(key: string, expiresIn: number): Promise<string>;

  /**
   * Get file metadata
   * @param key - File identifier
   * @returns Promise resolving to file metadata
   * @throws FileNotFoundError if file doesn't exist
   */
  getMetadata?(key: string): Promise<FileMetadata>;
}

export interface FileMetadata {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
}

/**
 * Custom Storage Errors
 */
export class FileNotFoundError extends Error {
  constructor(key: string) {
    super(`File not found: ${key}`);
    this.name = 'FileNotFoundError';
  }
}

export class FileSizeLimitError extends Error {
  constructor(size: number, limit: number) {
    super(`File size ${size} bytes exceeds limit of ${limit} bytes`);
    this.name = 'FileSizeLimitError';
  }
}

export class StorageProviderError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'StorageProviderError';
  }
}
