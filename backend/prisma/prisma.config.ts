import type { PrismaClientOptions } from '@prisma/client';

export const config: PrismaClientOptions = {
  // Configuration for Prisma Client
};

// For migrations, we still need the datasource URL
export const datasourceUrl = process.env.DATABASE_URL || 'file:./database.sqlite';
