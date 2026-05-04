import { PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { UploadStatus } from '../types/upload.types';

export interface CompleteUploadStatusParams {
  rowsProcessed: number;
  rowsTotal: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowErrorCount: number;
  columnsUsed: string;
  columnsIgnored: number;
}

@injectable()
export class UploadRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findStatusByFileKey(fileKey: string): Promise<any | null> {
    return this.prisma.upload.findUnique({
      where: { fileKey },
      select: {
        status: true,
        uploadProgress: true,
        processingMessage: true,
        errorMessage: true,
        rowsProcessed: true,
        rowsTotal: true,
        rowsImported: true,
        rowsUpdated: true,
        rowsSkipped: true,
        rowErrorCount: true,
        columnsUsed: true,
        columnsIgnored: true,
        organizationId: true,
      },
    });
  }

  async markCompleted(fileKey: string, data: CompleteUploadStatusParams): Promise<any> {
    return this.prisma.upload.updateMany({
      where: { fileKey },
      data: {
        status: UploadStatus.COMPLETED,
        ...data,
      },
    });
  }

  async markFailed(fileKey: string, errorMessage?: string): Promise<any> {
    return this.prisma.upload.updateMany({
      where: { fileKey },
      data: {
        status: UploadStatus.FAILED,
        ...(errorMessage
          ? {
              errorMessage,
              rowsImported: 0,
              rowsUpdated: 0,
              rowsSkipped: 0,
              rowErrorCount: 0,
            }
          : {}),
      },
    });
  }
}
