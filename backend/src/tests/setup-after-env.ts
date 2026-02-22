import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');
  // Truncate all tables before each test to ensure a clean state
  const tablenames = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations';`;

  for (const { name } of tablenames) {
    if (name === 'users') {
      continue;
    }
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${name}";`);
    } catch (error) {
      console.log(`Failed to clean table ${name}:`, error);
    }
  }

  // Seed essential data (Users)
  await Promise.all([
    prisma.user.upsert({
      where: { id: 1 },
      update: {
        role: 'Manager',
      },
      create: {
        id: 1,
        role: 'Manager',
      },
    }),
    prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
      },
      create: {
        id: 2,
        role: 'Staff',
      },
    }),
  ]);
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
});

afterAll(async () => {
  await prisma.$disconnect();
});
