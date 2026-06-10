import { UploadRepository } from '../../repositories/upload.repository';
import { UploadStatus } from '../../types/upload.types';

describe('UploadRepository', () => {
  let prisma: {
    $queryRaw: jest.Mock;
    upload: {
      updateMany: jest.Mock;
    };
  };
  let repository: UploadRepository;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      upload: {
        updateMany: jest.fn(),
      },
    };
    repository = new UploadRepository(prisma as never);
  });

  it('finds upload status fields by file key', async () => {
    const upload = { fileKey: 'uploads/org-1/file.csv', status: UploadStatus.PROCESSING };
    prisma.$queryRaw.mockResolvedValue([upload]);

    const result = await repository.findStatusByFileKey(upload.fileKey);

    expect(result).toBe(upload);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prisma.$queryRaw.mock.calls[0][0])).toContain(upload.fileKey);
  });

  it('marks an upload completed with processing metrics', async () => {
    prisma.upload.updateMany.mockResolvedValue({ count: 1 });

    await repository.markCompleted('uploads/org-1/file.csv', {
      rowsProcessed: 3,
      rowsTotal: 4,
      rowsImported: 1,
      rowsUpdated: 1,
      rowsSkipped: 1,
      rowErrorCount: 1,
      columnsUsed: '["sku"]',
      columnsIgnored: 2,
    });

    expect(prisma.upload.updateMany).toHaveBeenCalledWith({
      where: { fileKey: 'uploads/org-1/file.csv' },
      data: {
        status: UploadStatus.COMPLETED,
        rowsProcessed: 3,
        rowsTotal: 4,
        rowsImported: 1,
        rowsUpdated: 1,
        rowsSkipped: 1,
        rowErrorCount: 1,
        columnsUsed: '["sku"]',
        columnsIgnored: 2,
      },
    });
  });

  it('marks an upload failed with optional error details', async () => {
    prisma.upload.updateMany.mockResolvedValue({ count: 1 });

    await repository.markFailed('uploads/org-1/file.csv', 'parse failed');

    expect(prisma.upload.updateMany).toHaveBeenCalledWith({
      where: { fileKey: 'uploads/org-1/file.csv' },
      data: {
        status: UploadStatus.FAILED,
        errorMessage: 'parse failed',
        rowsImported: 0,
        rowsUpdated: 0,
        rowsSkipped: 0,
        rowErrorCount: 0,
      },
    });
  });
});
