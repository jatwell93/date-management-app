import { PrismaClient } from './generated/client';

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
        pin: '$2b$10$UMJOpNj6R17PoIKYLkQYjezcshKlz8uxxdV9CDt8YE8BzpfVGexF2', // Hash for 5624
      },
      create: {
        id: 1,
        role: 'Manager',
        pin: '$2b$10$UMJOpNj6R17PoIKYLkQYjezcshKlz8uxxdV9CDt8YE8BzpfVGexF2', // Hash for 5624
      },
    }),
    prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
        pin: '$2b$10$bAs8NbKUfEI6VU9ScMw5mO.h2lQDTfXnGZSSJnAR5pUXZNUS96RHO', // Hash for 1234
      },
      create: {
        id: 2,
        role: 'Staff',
        pin: '$2b$10$bAs8NbKUfEI6VU9ScMw5mO.h2lQDTfXnGZSSJnAR5pUXZNUS96RHO', // Hash for 1234
      },
    }),
  ]);
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
});

afterAll(async () => {
  await prisma.$disconnect();
});
