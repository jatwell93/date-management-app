import { MigrationService } from './migration.service';
import { Logger } from '../utils/logger';

// Run migrations using the MigrationService
export async function runMigrations(): Promise<void> {
  const migrationService = new MigrationService();

  try {
    await migrationService.runMigrations();
  } catch (error) {
    Logger.error('Migration process failed:', error);
    throw error;
  }
}

// Export the MigrationService for direct usage if needed
export { MigrationService } from './migration.service';
