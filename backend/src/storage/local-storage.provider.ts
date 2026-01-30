/**
 * Local Storage Provider
 *
 * Filesystem-based storage provider for development environment.
 * Stores files in the local uploads directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  StorageProvider,
  FileMetadata,
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from './storage-provider.interface';

export interface LocalStorageConfig {
  basePath: string;
  maxFileSizeBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;
  private readonly maxFileSizeBytes: number;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  }

  /**
   * Get the full filesystem path for a storage key
   */
  private getFullPath(key: string): string {
    // Sanitize key to prevent directory traversal attacks
    const sanitizedKey = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(this.basePath, sanitizedKey);
  }

  /**
   * Ensure the directory exists for a file path
   */
  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    // Validate file size
    if (data.length > this.maxFileSizeBytes) {
      throw new FileSizeLimitError(data.length, this.maxFileSizeBytes);
    }

    const fullPath = this.getFullPath(key);

    try {
      await this.ensureDirectory(fullPath);
      await fs.writeFile(fullPath, data);

      // Store metadata in a sidecar JSON file
      const metadataPath = `${fullPath}.meta.json`;
      const metadata: FileMetadata = {
        key,
        size: data.length,
        contentType,
        lastModified: new Date(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      return key;
    } catch (error) {
      throw new StorageProviderError(
        `Failed to upload file: ${key}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);

    try {
      const data = await fs.readFile(fullPath);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(key);
      }
      throw new StorageProviderError(
        `Failed to download file: ${key}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    const metadataPath = `${fullPath}.meta.json`;

    try {
      // Check if file exists first
      await fs.access(fullPath);

      // Delete the file
      await fs.unlink(fullPath);

      // Delete metadata file if it exists
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Ignore if metadata file doesn't exist
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(key);
      }
      throw new StorageProviderError(
        `Failed to delete file: ${key}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const fullPath = this.getFullPath(key);
    const metadataPath = `${fullPath}.meta.json`;

    try {
      // Try to read from sidecar metadata file first
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(metadataContent);
      // Ensure lastModified is a Date object (JSON stringifies dates)
      return {
        ...parsed,
        lastModified: new Date(parsed.lastModified),
      } as FileMetadata;
    } catch {
      // Fall back to stat-based metadata
      try {
        const stats = await fs.stat(fullPath);
        return {
          key,
          size: stats.size,
          contentType: 'application/octet-stream', // Default content type
          lastModified: stats.mtime,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new FileNotFoundError(key);
        }
        throw new StorageProviderError(
          `Failed to get metadata for file: ${key}`,
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  /**
   * Local storage doesn't support presigned URLs.
   * This method throws an error if called.
   */
  async getPresignedUploadUrl(_key: string, _expiresIn: number): Promise<string> {
    throw new StorageProviderError('Presigned URLs are not supported in local storage mode');
  }
}
