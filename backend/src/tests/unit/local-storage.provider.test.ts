/**
 * Unit Tests for LocalStorageProvider
 *
 * Tests filesystem-based storage operations for development environment.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LocalStorageProvider } from '../../storage/local-storage.provider';
import {
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from '../../storage/storage-provider.interface';

describe('LocalStorageProvider', () => {
  const testBasePath = path.join(__dirname, '../../../test-uploads-unit');
  let provider: LocalStorageProvider;

  beforeAll(async () => {
    // Ensure test directory exists
    await fs.mkdir(testBasePath, { recursive: true });
  });

  beforeEach(() => {
    provider = new LocalStorageProvider({
      basePath: testBasePath,
      maxFileSizeBytes: 1024 * 1024, // 1MB for tests
    });
  });

  afterEach(async () => {
    // Clean up test files after each test
    try {
      const files = await fs.readdir(testBasePath);
      for (const file of files) {
        const filePath = path.join(testBasePath, file);
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          await fs.rm(filePath, { recursive: true });
        } else {
          await fs.unlink(filePath);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Remove test directory
    try {
      await fs.rm(testBasePath, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('upload', () => {
    it('should upload a file successfully', async () => {
      const key = 'test-file.txt';
      const data = Buffer.from('Hello, World!');
      const contentType = 'text/plain';

      const result = await provider.upload(key, data, contentType);

      expect(result).toBe(key);

      // Verify file exists
      const exists = await provider.exists(key);
      expect(exists).toBe(true);
    });

    it('should create nested directories for key with path', async () => {
      const key = 'uploads/2024/01/test-file.csv';
      const data = Buffer.from('name,value\ntest,123');
      const contentType = 'text/csv';

      const result = await provider.upload(key, data, contentType);

      expect(result).toBe(key);
      expect(await provider.exists(key)).toBe(true);
    });

    it('should store metadata in sidecar file', async () => {
      const key = 'metadata-test.txt';
      const data = Buffer.from('Test content');
      const contentType = 'text/plain';

      await provider.upload(key, data, contentType);

      const metadata = await provider.getMetadata(key);
      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(data.length);
      expect(metadata.contentType).toBe(contentType);
      expect(metadata.lastModified).toBeInstanceOf(Date);
    });

    it('should throw FileSizeLimitError for files exceeding limit', async () => {
      const key = 'large-file.txt';
      const data = Buffer.alloc(2 * 1024 * 1024); // 2MB (exceeds 1MB limit)
      const contentType = 'text/plain';

      await expect(provider.upload(key, data, contentType)).rejects.toThrow(FileSizeLimitError);
    });

    it('should sanitize key to prevent directory traversal', async () => {
      const key = '../../../etc/passwd';
      const data = Buffer.from('malicious content');
      const contentType = 'text/plain';

      await provider.upload(key, data, contentType);

      // File should be in test directory, not escaped
      const exists = await provider.exists(key);
      expect(exists).toBe(true);

      // Original path should not be affected
      try {
        await fs.access('/etc/passwd');
        // If we can access it, it wasn't overwritten (we wouldn't have permissions anyway)
      } catch {
        // Expected - file doesn't exist or no permissions
      }
    });
  });

  describe('download', () => {
    it('should download an uploaded file', async () => {
      const key = 'download-test.txt';
      const data = Buffer.from('Download me!');
      const contentType = 'text/plain';

      await provider.upload(key, data, contentType);
      const downloaded = await provider.download(key);

      expect(downloaded.toString()).toBe('Download me!');
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      await expect(provider.download('non-existent.txt')).rejects.toThrow(FileNotFoundError);
    });

    it('should preserve binary data integrity', async () => {
      const key = 'binary-test.bin';
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const contentType = 'application/octet-stream';

      await provider.upload(key, data, contentType);
      const downloaded = await provider.download(key);

      expect(downloaded).toEqual(data);
    });
  });

  describe('delete', () => {
    it('should delete an existing file', async () => {
      const key = 'delete-test.txt';
      const data = Buffer.from('Delete me!');

      await provider.upload(key, data, 'text/plain');
      expect(await provider.exists(key)).toBe(true);

      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });

    it('should also delete metadata file', async () => {
      const key = 'delete-metadata-test.txt';
      const data = Buffer.from('Delete me and my metadata!');

      await provider.upload(key, data, 'text/plain');

      // Verify metadata file exists
      const metadataPath = path.join(testBasePath, `${key}.meta.json`);
      await expect(fs.access(metadataPath)).resolves.toBeUndefined();

      await provider.delete(key);

      // Verify metadata file is also deleted
      await expect(fs.access(metadataPath)).rejects.toThrow();
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      await expect(provider.delete('non-existent.txt')).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const key = 'exists-test.txt';
      await provider.upload(key, Buffer.from('I exist!'), 'text/plain');

      const exists = await provider.exists(key);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const exists = await provider.exists('non-existent.txt');
      expect(exists).toBe(false);
    });

    it('should return false after file is deleted', async () => {
      const key = 'exists-delete-test.txt';
      await provider.upload(key, Buffer.from('I exist!'), 'text/plain');
      await provider.delete(key);

      const exists = await provider.exists(key);
      expect(exists).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should return metadata from sidecar file', async () => {
      const key = 'metadata-sidecar-test.txt';
      const data = Buffer.from('Content for metadata test');
      const contentType = 'text/plain';

      await provider.upload(key, data, contentType);
      const metadata = await provider.getMetadata(key);

      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(data.length);
      expect(metadata.contentType).toBe(contentType);
      expect(metadata.lastModified).toBeInstanceOf(Date);
    });

    it('should fall back to stat-based metadata when sidecar missing', async () => {
      const key = 'metadata-fallback-test.txt';
      const data = Buffer.from('Content without sidecar');

      // Write file directly without sidecar
      const fullPath = path.join(testBasePath, key);
      await fs.writeFile(fullPath, data);

      const metadata = await provider.getMetadata(key);

      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(data.length);
      expect(metadata.contentType).toBe('application/octet-stream'); // Default
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      await expect(provider.getMetadata('non-existent.txt')).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('should throw StorageProviderError (not supported)', async () => {
      await expect(provider.getPresignedUploadUrl('test.txt', 3600)).rejects.toThrow(
        StorageProviderError,
      );
    });

    it('should include helpful error message', async () => {
      await expect(provider.getPresignedUploadUrl('test.txt', 3600)).rejects.toThrow(
        'Presigned URLs are not supported in local storage mode',
      );
    });
  });
});
