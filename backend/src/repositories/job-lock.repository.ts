import { PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

interface ErrorWithCode {
  code?: string;
}

@injectable()
export class JobLockRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async acquire(lockKey: string, timeoutMinutes: number = 10): Promise<boolean> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + timeoutMinutes);

    try {
      await this.prisma.$executeRaw`
        INSERT INTO migrations (name, appliedAt)
        VALUES (${lockKey}, ${expiresAt})
      `;
      return true;
    } catch (error: unknown) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as ErrorWithCode).code
          : undefined;

      if (errorCode === 'SQLITE_CONSTRAINT') {
        const existingLock = (await this.prisma.$queryRaw`
          SELECT appliedAt FROM migrations WHERE name = ${lockKey}
        `) as Array<{ appliedAt: Date }>;

        if (existingLock.length > 0 && existingLock[0].appliedAt < new Date()) {
          await this.release(lockKey);
          return this.acquire(lockKey, timeoutMinutes);
        }
      }

      return false;
    }
  }

  async release(lockKey: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM migrations WHERE name = ${lockKey}
    `;
  }
}
