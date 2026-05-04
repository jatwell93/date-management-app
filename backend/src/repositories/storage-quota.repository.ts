import { PrismaClient } from '@prisma/client';
import { inject, injectable } from 'tsyringe';
import { UploadStatus } from '../types/upload.types';

export interface RecordUploadParams {
  organizationId: string;
  userId: number;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number;
  contentType?: string;
}

@injectable()
export class StorageQuotaRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async sumActiveUploadBytes(organizationId: string): Promise<number> {
    const result = await this.prisma.upload.aggregate({
      where: {
        organizationId,
        status: {
          in: [UploadStatus.PROCESSING, UploadStatus.COMPLETED],
        },
      },
      _sum: {
        fileSizeBytes: true,
      },
    });

    return result._sum.fileSizeBytes ?? 0;
  }

  async recordUpload(params: RecordUploadParams): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.upload.create({
        data: {
          organizationId: params.organizationId,
          userId: params.userId,
          fileKey: params.fileKey,
          fileName: params.fileName,
          fileSizeBytes: params.fileSizeBytes,
          contentType: params.contentType,
          status: UploadStatus.PROCESSING,
        },
      });

      await tx.organizationUsage.upsert({
        where: {
          organizationId: params.organizationId,
        },
        update: {
          storageUsedBytes: {
            increment: params.fileSizeBytes,
          },
        },
        create: {
          organizationId: params.organizationId,
          storageUsedBytes: params.fileSizeBytes,
          totalSkus: 0,
          activeUsers: 0,
          maxUsers: 0,
          maxSkus: 0,
        },
      });
    });
  }

  async markUploadDeleted(organizationId: string, fileKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const upload = (await tx.upload.findUnique({
        where: { fileKey },
        select: { fileSizeBytes: true },
      })) as { fileSizeBytes: number } | null;

      if (!upload) {
        return;
      }

      await tx.upload.update({
        where: { fileKey },
        data: { status: 'deleted' },
      });

      await tx.organizationUsage.update({
        where: {
          organizationId,
        },
        data: {
          storageUsedBytes: {
            decrement: upload.fileSizeBytes,
          },
        },
      });
    });
  }
}
