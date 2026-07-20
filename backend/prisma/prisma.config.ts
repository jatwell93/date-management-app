// Prisma configuration for client generation
// This file is used by Prisma CLI for client configuration

export const config = {
  // Configuration for Prisma Client
};

// For migrations, we still need the datasource URL
// This will be used by prisma migrate commands
export const datasourceUrl =
  process.env.DATABASE_URL || process.env.NEON_CONNECTION_STRING || 'file:../database.sqlite';
