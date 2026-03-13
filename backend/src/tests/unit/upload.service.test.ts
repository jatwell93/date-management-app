import { UploadService } from '../../services/upload.service';
import { StorageProvider } from '../../storage/storage-provider.interface';
import { CSVParserService } from '../../services/csv-parser.service';
import { StorageQuotaService } from '../../services/storage-quota.service';
import { envConfig } from '../../config/environment';

describe('UploadService', () => {
  let uploadService: UploadService;
  let mockStorage: jest.Mocked<StorageProvider>;
  let mockCsvParser: jest.Mocked<CSVParserService>;
  let mockStorageQuotaService: jest.Mocked<StorageQuotaService>;
  const organizationId = 'org-123';

  beforeEach(() => {
    mockStorage = {
      upload: jest.fn() as jest.Mock,
      download: jest.fn() as jest.Mock,
      delete: jest.fn() as jest.Mock,
      exists: jest.fn() as jest.Mock,
      getMetadata: jest.fn() as jest.Mock,
      getPresignedUploadUrl: jest.fn() as jest.Mock,
    } as any as jest.Mocked<StorageProvider>;

    mockCsvParser = {
      processFile: jest.fn() as jest.Mock,
    } as any as jest.Mocked<CSVParserService>;

    mockStorageQuotaService = {
      recordUpload: jest.fn() as jest.Mock,
      markUploadDeleted: jest.fn() as jest.Mock,
    } as any as jest.Mocked<StorageQuotaService>;

    uploadService = new UploadService(
      organizationId,
      mockStorage,
      mockCsvParser,
      mockStorageQuotaService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initiateUpload', () => {
    it('should return direct upload strategy for small files', async () => {
      const result = await uploadService.initiateUpload('test.csv', 1024 * 1024, 'text/csv'); // 1MB

      expect(result.strategy).toBe('direct');
      expect(result.uploadUrl).toBe('/api/upload/direct');
      expect(result.method).toBe('POST');
      expect(result.key).toMatch(/^uploads\/org-123\/\d+-test\.csv$/);
    });

    it('should return presigned upload strategy for large files in production', async () => {
      // Mock production environment and small threshold to force presigned
      const originalNodeEnv = envConfig.NODE_ENV;
      const originalThreshold = envConfig.DIRECT_UPLOAD_THRESHOLD_BYTES;

      // Mock envConfig for this test
      (envConfig as any).NODE_ENV = 'production';
      (envConfig as any).DIRECT_UPLOAD_THRESHOLD_BYTES = 1024; // 1KB threshold

      (mockStorage.getPresignedUploadUrl as jest.Mock).mockResolvedValue(
        'https://presigned-url.com',
      );

      const result = await uploadService.initiateUpload('large.csv', 5 * 1024 * 1024, 'text/csv'); // 5MB

      expect(result.strategy).toBe('presigned');
      expect(result.uploadUrl).toBe('https://presigned-url.com');
      expect(result.method).toBe('PUT');
      expect(result.key).toMatch(/^uploads\/org-123\/\d+-large\.csv$/);

      // Restore original values
      (envConfig as any).NODE_ENV = originalNodeEnv;
      (envConfig as any).DIRECT_UPLOAD_THRESHOLD_BYTES = originalThreshold;
    });

    it('should throw error for files exceeding maximum size', async () => {
      const maxSize = 10 * 1024 * 1024; // 10MB

      await expect(
        uploadService.initiateUpload('too-big.csv', maxSize + 1, 'text/csv'),
      ).rejects.toThrow(`File size exceeds maximum limit of ${maxSize} bytes`);
    });
  });

  describe('completeUpload', () => {
    it('should complete upload and process file successfully', async () => {
      const key = 'uploads/123-test.csv';
      const userId = 1;
      const fileBuffer = Buffer.from('test,csv,data');
      const metadata = { size: fileBuffer.length, contentType: 'text/csv' };

      mockStorage.exists.mockResolvedValue(true);
      (mockStorage.getMetadata as jest.Mock).mockResolvedValue(metadata);
      mockStorage.download.mockResolvedValue(fileBuffer);
      (mockCsvParser.processFile as jest.Mock).mockResolvedValue({
        imported: 3,
        updated: 0,
        skipped: 0,
        total: 3,
        errors: [],
        durationMs: 50,
      });

      await uploadService.completeUpload(key, userId);

      expect(mockStorage.exists).toHaveBeenCalledWith(key);
      expect(mockStorage.getMetadata).toHaveBeenCalledWith(key);
      expect(mockStorage.download).toHaveBeenCalledWith(key);
      expect(mockStorageQuotaService.recordUpload).toHaveBeenCalledWith(
        organizationId,
        userId,
        key,
        '123-test.csv',
        fileBuffer.length,
        'text/csv',
      );
      expect(mockCsvParser.processFile).toHaveBeenCalledWith(expect.stringContaining('test.csv'), {
        uploadKey: key,
        userId,
      });
    });

    it('should throw error if file does not exist in storage', async () => {
      mockStorage.exists.mockResolvedValue(false);

      await expect(uploadService.completeUpload('uploads/123-test.csv', 1)).rejects.toThrow(
        'File upload verification failed: File not found in storage',
      );
    });
  });

  describe('handleDirectUpload', () => {
    it('should handle direct upload successfully', async () => {
      const buffer = Buffer.from('test,csv,data');
      const filename = 'test.csv';
      const contentType = 'text/csv';
      const userId = 1;

      mockStorage.upload.mockResolvedValue('uploads/123-test.csv');
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.download.mockResolvedValue(buffer);
      (mockStorage.getMetadata as jest.Mock).mockResolvedValue({
        size: buffer.length,
        contentType: 'text/csv',
      });
      (mockCsvParser.processFile as jest.Mock).mockResolvedValue({
        imported: 3,
        updated: 0,
        skipped: 0,
        total: 3,
        errors: [],
        durationMs: 50,
      });

      const key = await uploadService.handleDirectUpload(buffer, filename, contentType, userId);

      expect(mockStorage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^uploads\/org-123\/\d+-test\.csv$/),
        buffer,
        contentType,
      );
      expect(key).toMatch(/^uploads\/org-123\/\d+-test\.csv$/);
    });
  });

  describe('deleteUpload', () => {
    it('should delete upload and update storage quota', async () => {
      const key = 'uploads/123-test.csv';

      mockStorage.delete.mockResolvedValue(undefined);
      mockStorageQuotaService.markUploadDeleted.mockResolvedValue(undefined);

      await uploadService.deleteUpload(key);

      expect(mockStorage.delete).toHaveBeenCalledWith(key);
      expect(mockStorageQuotaService.markUploadDeleted).toHaveBeenCalledWith(organizationId, key);
    });

    it('should throw error if storage deletion fails', async () => {
      const key = 'uploads/123-test.csv';
      const error = new Error('Storage deletion failed');

      mockStorage.delete.mockRejectedValue(error);

      await expect(uploadService.deleteUpload(key)).rejects.toThrow('Storage deletion failed');
    });
  });
});
