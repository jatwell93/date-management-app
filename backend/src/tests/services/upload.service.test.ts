import { UploadService } from '../../services/upload.service';
import { StorageProvider } from '../../storage/storage-provider.interface';
import { CSVParserService } from '../../services/csv-parser.service';
import { StorageQuotaService } from '../../services/storage-quota.service';

// Mock dependencies
const mockStorageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  getPresignedUploadUrl: jest.fn(),
} as unknown as jest.Mocked<StorageProvider>;

const mockCsvParserService = {
  processFile: jest.fn(),
} as unknown as jest.Mocked<CSVParserService>;

const mockStorageQuotaService = {
  recordUpload: jest.fn().mockResolvedValue(undefined),
  markUploadDeleted: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<StorageQuotaService>;

const mockUploadRepository = {
  markCompleted: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined),
};
const mockGetDefaultDatabaseClient = jest.fn();

jest.mock('../../config/environment', () => ({
  envConfig: {
    NODE_ENV: 'development',
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
    DIRECT_UPLOAD_THRESHOLD_BYTES: 2 * 1024 * 1024, // 2MB
  },
}));

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
}));

jest.mock('../../di/container', () => ({
  getDiContainer: () => ({
    resolve: (token: unknown) => {
      const tokenName =
        typeof token === 'function' && 'name' in token ? (token as { name: string }).name : token;

      if (tokenName === 'UploadRepository') {
        return mockUploadRepository;
      }

      throw new Error(`Unexpected DI token: ${String(tokenName)}`);
    },
  }),
}));

// Mock fs to avoid actual file I/O during tests
jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
  unlink: jest.fn(),
}));
import * as fs from 'fs/promises';

describe('UploadService', () => {
  let uploadService: UploadService;
  const organizationId = 'org-123';

  beforeEach(() => {
    jest.clearAllMocks();
    uploadService = new UploadService(
      organizationId,
      mockStorageProvider,
      mockCsvParserService,
      mockStorageQuotaService,
    );
  });

  it('resolves the default upload repository from DI without using the database factory', async () => {
    const filename = 'test.csv';
    const key = `uploads/${organizationId}/${filename}`;
    const mockBuffer = Buffer.from('header1,header2\nval1,val2');
    mockStorageProvider.exists.mockResolvedValue(true);
    mockStorageProvider.download.mockResolvedValue(mockBuffer);
    (mockCsvParserService.processFile as jest.Mock).mockResolvedValue({
      imported: 1,
      updated: 0,
      skipped: 0,
      total: 1,
      errors: [],
    });

    await uploadService.completeUpload(key, 1);

    expect(mockUploadRepository.markCompleted).toHaveBeenCalledWith(
      key,
      expect.objectContaining({
        rowsProcessed: 1,
        rowsTotal: 1,
      }),
    );
    expect(mockGetDefaultDatabaseClient).not.toHaveBeenCalled();
  });

  describe('initiateUpload', () => {
    it('should return DIRECT strategy for small files in development', async () => {
      const result = await uploadService.initiateUpload('test.csv', 1024, 'text/csv');

      expect(result).toEqual({
        strategy: 'direct',
        uploadUrl: '/api/upload/direct',
        method: 'POST',
        key: expect.stringMatching(/test\.csv$/),
      });
    });

    it('should return DIRECT strategy for large files in development', async () => {
      // Even large files use direct in dev because local storage doesn't support presigned
      const result = await uploadService.initiateUpload('large.csv', 5 * 1024 * 1024, 'text/csv');

      expect(result.strategy).toBe('direct');
    });

    it('should throw error if file size exceeds absolute maximum', async () => {
      const tooBig = 15 * 1024 * 1024; // 15MB

      await expect(uploadService.initiateUpload('huge.csv', tooBig, 'text/csv')).rejects.toThrow(
        'File size exceeds maximum limit',
      );
    });
  });

  describe('completeUpload', () => {
    it('should parse file if it exists', async () => {
      const filename = 'test.csv';
      const key = `uploads/${organizationId}/${filename}`;
      const mockBuffer = Buffer.from('header1,header2\nval1,val2');
      mockStorageProvider.exists.mockResolvedValue(true);
      mockStorageProvider.download.mockResolvedValue(mockBuffer);
      (mockCsvParserService.processFile as jest.Mock).mockResolvedValue({
        imported: 1,
        errors: [],
      });

      await uploadService.completeUpload(key, 1);

      expect(mockStorageProvider.exists).toHaveBeenCalledWith(key);
      expect(mockStorageProvider.download).toHaveBeenCalledWith(key);
      // Temp file path contains filename but probably not the full key (upload dir)
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining(filename), mockBuffer);
      expect(mockCsvParserService.processFile).toHaveBeenCalledWith(
        expect.stringContaining(filename),
        { uploadKey: key, userId: 1, importType: 'product-catalog' },
      );
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining(filename));
    });

    it('should throw error if file does not exist', async () => {
      const key = `uploads/${organizationId}/missing.csv`;
      mockStorageProvider.exists.mockResolvedValue(false);

      await expect(uploadService.completeUpload(key, 1)).rejects.toThrow(
        'File upload verification failed',
      );
    });
  });

  describe('handleDirectUpload', () => {
    it('should upload file to storage and trigger processing', async () => {
      const buffer = Buffer.from('data');
      const filename = 'direct.csv';
      const key = `uploads/${organizationId}/123-${filename}`;
      // mock Date.now
      jest.spyOn(Date, 'now').mockReturnValue(123);

      mockStorageProvider.upload.mockResolvedValue(key);
      (mockCsvParserService.processFile as jest.Mock).mockResolvedValue({ imported: 1 });
      mockStorageProvider.exists.mockResolvedValue(true);
      mockStorageProvider.download.mockResolvedValue(buffer);

      const result = await uploadService.handleDirectUpload(buffer, filename, 'text/csv', 1);

      expect(mockStorageProvider.upload).toHaveBeenCalledWith(key, buffer, 'text/csv');
      // Verify completeUpload logic was executed (we can spy on completeUpload if we want, or just verify effects)
      expect(mockCsvParserService.processFile).toHaveBeenCalled();
      expect(result.key).toBe(key);
      expect(result.processingResult).toMatchObject({
        importType: 'product-catalog',
      });
    });
  });
});
