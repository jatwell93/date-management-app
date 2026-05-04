import { PrismaClient } from '@prisma/client';
import { StorageQuotaRepository } from '../../repositories/storage-quota.repository';
import { UploadStatus } from '../../types/upload.types';

describe('StorageQuotaRepository', () => {
  let prisma: {
    upload: {
      aggregate: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    organizationUsage: {
      upsert: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: StorageQuotaRepository;

  beforeEach(() => {
    prisma = {
      upload: {
        aggregate: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      organizationUsage: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
      ),
    };
    repository = new StorageQuotaRepository(prisma as unknown as PrismaClient);
  });

  it('sums processing and completed upload bytes for an organization', async () => {
    prisma.upload.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: 5120 } });

    const result = await repository.sumActiveUploadBytes('org-123');

    expect(result).toBe(5120);
    expect(prisma.upload.aggregate).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-123',
        status: {
          in: [UploadStatus.PROCESSING, UploadStatus.COMPLETED],
        },
      },
      _sum: {
        fileSizeBytes: true,
      },
    });
  });

  it('records upload metadata and increments organization storage in one transaction', async () => {
    await repository.recordUpload({
      organizationId: 'org-123',
      userId: 7,
      fileKey: 'uploads/org-123/items.csv',
      fileName: 'items.csv',
      fileSizeBytes: 4096,
      contentType: 'text/csv',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.upload.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-123',
        userId: 7,
        fileKey: 'uploads/org-123/items.csv',
        fileName: 'items.csv',
        fileSizeBytes: 4096,
        contentType: 'text/csv',
        status: UploadStatus.PROCESSING,
      },
    });
    expect(prisma.organizationUsage.upsert).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-123',
      },
      update: {
        storageUsedBytes: {
          increment: 4096,
        },
      },
      create: {
        organizationId: 'org-123',
        storageUsedBytes: 4096,
        totalSkus: 0,
        activeUsers: 0,
        maxUsers: 0,
        maxSkus: 0,
      },
    });
  });

  it('marks an upload deleted and decrements usage when the file exists', async () => {
    prisma.upload.findUnique.mockResolvedValue({ fileSizeBytes: 2048 });

    await repository.markUploadDeleted('org-123', 'uploads/org-123/items.csv');

    expect(prisma.upload.findUnique).toHaveBeenCalledWith({
      where: { fileKey: 'uploads/org-123/items.csv' },
      select: { fileSizeBytes: true },
    });
    expect(prisma.upload.update).toHaveBeenCalledWith({
      where: { fileKey: 'uploads/org-123/items.csv' },
      data: { status: 'deleted' },
    });
    expect(prisma.organizationUsage.update).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-123',
      },
      data: {
        storageUsedBytes: {
          decrement: 2048,
        },
      },
    });
  });

  it('does not decrement usage when the upload does not exist', async () => {
    prisma.upload.findUnique.mockResolvedValue(null);

    await repository.markUploadDeleted('org-123', 'missing.csv');

    expect(prisma.upload.update).not.toHaveBeenCalled();
    expect(prisma.organizationUsage.update).not.toHaveBeenCalled();
  });
});
