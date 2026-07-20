describe('Prisma datasource defaults', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNeonConnectionString = process.env.NEON_CONNECTION_STRING;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NEON_CONNECTION_STRING = originalNeonConnectionString;
    vi.resetModules();
  });

  it('defaults local Prisma to the runtime SQLite database file', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.NEON_CONNECTION_STRING;

    const { datasourceUrl } = await import('../../../prisma/prisma.config');

    expect(datasourceUrl).toBe('file:../database.sqlite');
  });
});
