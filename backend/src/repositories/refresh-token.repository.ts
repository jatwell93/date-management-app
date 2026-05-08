import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

type RefreshTokenRecord = Prisma.RefreshTokenGetPayload<Record<string, never>>;
type RefreshTokenWithUser = Prisma.RefreshTokenGetPayload<{ include: { user: true } }>;

@injectable()
export class RefreshTokenRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(client?: DbClient): DbClient {
    return client ?? this.prisma;
  }

  async create(
    data: { userId: number; token: string; expiresAt: Date },
    client?: DbClient,
  ): Promise<RefreshTokenRecord> {
    return this.getClient(client).refreshToken.create({ data });
  }

  async findByToken(token: string, client?: DbClient): Promise<RefreshTokenRecord | null> {
    return this.getClient(client).refreshToken.findUnique({
      where: { token },
    });
  }

  async findByTokenWithUser(token: string, client?: DbClient): Promise<RefreshTokenWithUser | null> {
    return this.getClient(client).refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async delete(id: number, client?: DbClient): Promise<void> {
    await this.getClient(client).refreshToken.delete({ where: { id } });
  }

  async revoke(id: number, client?: DbClient): Promise<RefreshTokenRecord> {
    return this.getClient(client).refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpired(client?: DbClient): Promise<number> {
    const result = await this.getClient(client).refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}
