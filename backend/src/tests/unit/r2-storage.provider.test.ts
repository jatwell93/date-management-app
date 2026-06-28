/**
 * Unit Tests for R2StorageProvider
 *
 * Tests Cloudflare R2 storage operations using mocked AWS SDK.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { R2StorageProvider } from '../../storage/r2-storage.provider';
import {
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from '../../storage/storage-provider.interface';

// Mock AWS SDK modules
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner');

const mockSend = vi.fn();
const MockS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

describe('R2StorageProvider', () => {
  let provider: R2StorageProvider;

  const config = {
    accountId: 'test-account-id',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucketName: 'test-bucket',
    maxFileSizeBytes: 1024 * 1024, // 1MB for tests
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup S3Client mock. A regular function (not an arrow) is required: the SUT
    // does `new S3Client(...)`, and Vitest invokes the mock impl with `new` — arrows
    // cannot be constructed.
    MockS3Client.mockImplementation(function () {
      return {
        send: mockSend,
      } as unknown as S3Client;
    } as unknown as () => S3Client);

    provider = new R2StorageProvider(config);
  });

  describe('constructor', () => {
    it('should initialize S3Client with correct R2 endpoint', () => {
      expect(MockS3Client).toHaveBeenCalledWith({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
    });
  });

  describe('upload', () => {
    it('should upload a file successfully', async () => {
      const key = 'test-file.txt';
      const data = Buffer.from('Hello, R2!');
      const contentType = 'text/plain';

      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload(key, data, contentType);

      expect(result).toBe(key);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('should throw FileSizeLimitError for files exceeding limit', async () => {
      const key = 'large-file.txt';
      const data = Buffer.alloc(2 * 1024 * 1024); // 2MB
      const contentType = 'text/plain';

      await expect(provider.upload(key, data, contentType)).rejects.toThrow(FileSizeLimitError);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw StorageProviderError on R2 error', async () => {
      const key = 'error-file.txt';
      const data = Buffer.from('Test');
      const contentType = 'text/plain';

      mockSend.mockRejectedValueOnce(new Error('R2 connection failed'));

      await expect(provider.upload(key, data, contentType)).rejects.toThrow(StorageProviderError);
    });
  });

  describe('download', () => {
    it('should download a file successfully', async () => {
      const key = 'test-file.txt';
      const fileContent = 'Hello from R2!';

      // Mock readable stream
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(fileContent);
        },
      };

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
      });

      const result = await provider.download(key);

      expect(result.toString()).toBe(fileContent);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('should throw FileNotFoundError for NoSuchKey error', async () => {
      const key = 'non-existent.txt';

      const error = new Error('NoSuchKey');
      (error as { name?: string }).name = 'NoSuchKey';
      mockSend.mockRejectedValueOnce(error);

      await expect(provider.download(key)).rejects.toThrow(FileNotFoundError);
    });

    it('should throw FileNotFoundError when Body is missing', async () => {
      const key = 'empty-body.txt';

      mockSend.mockResolvedValueOnce({ Body: null });

      await expect(provider.download(key)).rejects.toThrow(FileNotFoundError);
    });

    it('should throw StorageProviderError on other errors', async () => {
      const key = 'error-file.txt';

      mockSend.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.download(key)).rejects.toThrow(StorageProviderError);
    });
  });

  describe('delete', () => {
    it('should delete an existing file', async () => {
      const key = 'delete-test.txt';

      // First call is HeadObjectCommand (exists check)
      mockSend.mockResolvedValueOnce({ ContentLength: 100 });
      // Second call is DeleteObjectCommand
      mockSend.mockResolvedValueOnce({});

      await provider.delete(key);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadObjectCommand));
      expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(DeleteObjectCommand));
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      const key = 'non-existent.txt';

      const error = new Error('NotFound');
      (error as { name?: string }).name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      await expect(provider.delete(key)).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const key = 'existing-file.txt';

      mockSend.mockResolvedValueOnce({
        ContentLength: 100,
        ContentType: 'text/plain',
      });

      const result = await provider.exists(key);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should return false for NotFound error', async () => {
      const key = 'non-existent.txt';

      const error = new Error('NotFound');
      (error as { name?: string }).name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      const result = await provider.exists(key);

      expect(result).toBe(false);
    });

    it('should throw StorageProviderError on other errors', async () => {
      const key = 'error-file.txt';

      mockSend.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.exists(key)).rejects.toThrow(StorageProviderError);
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const key = 'metadata-test.txt';
      const lastModified = new Date('2024-01-15T10:00:00Z');

      mockSend.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'text/csv',
        LastModified: lastModified,
        ETag: '"abc123"',
      });

      const metadata = await provider.getMetadata(key);

      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(1024);
      expect(metadata.contentType).toBe('text/csv');
      expect(metadata.lastModified).toEqual(lastModified);
      expect(metadata.etag).toBe('"abc123"');
    });

    it('should throw FileNotFoundError for NotFound error', async () => {
      const key = 'non-existent.txt';

      const error = new Error('NotFound');
      (error as { name?: string }).name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      await expect(provider.getMetadata(key)).rejects.toThrow(FileNotFoundError);
    });

    it('should use default values for missing fields', async () => {
      const key = 'partial-metadata.txt';

      mockSend.mockResolvedValueOnce({
        // No ContentLength, ContentType, etc.
      });

      const metadata = await provider.getMetadata(key);

      expect(metadata.size).toBe(0);
      expect(metadata.contentType).toBe('application/octet-stream');
      expect(metadata.lastModified).toBeInstanceOf(Date);
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('should generate a presigned upload URL', async () => {
      const key = 'presigned-upload.txt';
      const expiresIn = 3600;
      const expectedUrl = 'https://r2.example.com/presigned?signature=abc123';

      mockGetSignedUrl.mockResolvedValueOnce(expectedUrl);

      const url = await provider.getPresignedUploadUrl(key, expiresIn);

      expect(url).toBe(expectedUrl);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.any(Object), // S3Client instance
        expect.any(PutObjectCommand),
        { expiresIn },
      );
    });

    it('should throw StorageProviderError on presigner error', async () => {
      const key = 'error-presign.txt';
      const expiresIn = 3600;

      mockGetSignedUrl.mockRejectedValueOnce(new Error('Signing failed'));

      await expect(provider.getPresignedUploadUrl(key, expiresIn)).rejects.toThrow(
        StorageProviderError,
      );
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('should generate a presigned download URL', async () => {
      const key = 'presigned-download.txt';
      const expiresIn = 3600;
      const expectedUrl = 'https://r2.example.com/presigned-download?signature=xyz789';

      mockGetSignedUrl.mockResolvedValueOnce(expectedUrl);

      const url = await provider.getPresignedDownloadUrl(key, expiresIn);

      expect(url).toBe(expectedUrl);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(GetObjectCommand),
        { expiresIn },
      );
    });

    it('should throw StorageProviderError on presigned download error', async () => {
      const key = 'error-presigned-download.txt';
      const expiresIn = 60;

      mockGetSignedUrl.mockRejectedValueOnce(new Error('Presign failed'));

      await expect(provider.getPresignedDownloadUrl(key, expiresIn)).rejects.toThrow(
        StorageProviderError,
      );
    });
  });
});
