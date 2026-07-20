// Must be first: migration 006 pulls in inventory.service, which uses tsyringe
// DI and needs the reflect-metadata polyfill. The server loads it in index.ts,
// but the standalone `npm run migrate` entrypoint has to load it itself or it
// crashes on a fresh database.
import 'reflect-metadata';
import { MigrationService } from './migration.service';
import { Logger } from '../utils/logger';

// Run migrations using the MigrationService
export async function runMigrations(): Promise<void> {
  const migrationService = new MigrationService();

  try {
    await migrationService.runMigrations();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    Logger.error('Migration process failed:', { error: errorMsg });
    throw error;
  }
}

if (require.main === module) {
  runMigrations().catch(() => {
    process.exit(1);
  });
}

// Export the MigrationService for direct usage if needed
export { MigrationService } from './migration.service';
