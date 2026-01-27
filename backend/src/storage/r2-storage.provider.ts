/**
 * R2 Storage Provider
 *
 * Cloudflare R2 storage provider for production environment.
 * Uses AWS S3-compatible API via @aws-sdk/client-s3.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  StorageProvider,
  FileMetadata,
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from './storage-provider.interface';

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  maxFileSizeBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly maxFileSizeBytes: number;

  constructor(config: R2StorageConfig) {
    this.bucketName = config.bucketName;
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;

    // Initialize S3-compatible client for Cloudflare R2
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    // Validate file size
    if (data.length > this.maxFileSizeBytes) {
      throw new FileSizeLimitError(data.length, this.maxFileSizeBytes);
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: data,
        ContentType: contentType,
      });

      await this.client.send(command);
      return key;
    } catch (error) {
      throw new StorageProviderError(
        `Failed to upload file to R2: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new FileNotFoundError(key);
      }

      // Convert readable stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      // Check for NoSuchKey error
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new FileNotFoundError(key);
      }
      if (error instanceof FileNotFoundError) {
        throw error;
      }
      throw new StorageProviderError(
        `Failed to download file from R2: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // First check if file exists
      const exists = await this.exists(key);
      if (!exists) {
        throw new FileNotFoundError(key);
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        throw error;
      }
      throw new StorageProviderError(
        `Failed to delete file from R2: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // NotFound means file doesn't exist
      if ((error as { name?: string }).name === 'NotFound') {
        return false;
      }
      // Any other error is unexpected
      throw new StorageProviderError(
        `Failed to check if file exists in R2: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      return {
        key,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified ?? new Date(),
        etag: response.ETag,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        throw new FileNotFoundError(key);
      }
      throw new StorageProviderError(
        `Failed to get metadata from R2: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getPresignedUploadUrl(key: string, expiresIn: number): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      return url;
    } catch (error) {
      throw new StorageProviderError(
        `Failed to generate presigned URL for: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate a presigned URL for downloading a file
   */
  async getPresignedDownloadUrl(key: string, expiresIn: number): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      return url;
    } catch (error) {
      throw new StorageProviderError(
        `Failed to generate presigned download URL for: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}
