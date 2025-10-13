#!/usr/bin/env node

import { MigrationService } from '../src/migrations/migration.service.js';
import { Logger } from '../src/utils/logger.js';

const migrationService = new MigrationService();

async function runCommand(command) {
  try {
    switch (command) {
      case 'up':
      case 'migrate':
        Logger.info('Running migrations...');
        await migrationService.runMigrations();
        Logger.info('Migrations completed successfully');
        break;
        
      case 'status':
        Logger.info('Checking migration status...');
        const status = await migrationService.getMigrationStatus();
        console.log('\nMigration Status:');
        console.log('=================');
        console.log(`Executed migrations: ${status.executed.length}`);
        console.log(`Pending migrations: ${status.pending.length}`);
        
        if (status.executed.length > 0) {
          console.log('\nExecuted migrations:');
          status.executed.forEach(m => {
            console.log(`  - ${m.id}: ${m.name} (${m.executed_at})`);
          });
        }
        
        if (status.pending.length > 0) {
          console.log('\nPending migrations:');
          status.pending.forEach(m => {
            console.log(`  - ${m.id}: ${m.name}`);
          });
        }
        break;
        
      case 'rollback':
        Logger.info('Rolling back last migration...');
        await migrationService.rollbackLastMigration();
        Logger.info('Rollback completed successfully');
        break;
        
      default:
        console.log('Usage: npm run migrate [up|status|rollback]');
        console.log('  up/migrate: Run pending migrations');
        console.log('  status: Show migration status');
        console.log('  rollback: Rollback the last migration');
        process.exit(1);
    }
  } catch (error) {
    Logger.error('Migration command failed:', error);
    process.exit(1);
  }
}

// Get the command from command line arguments
const command = process.argv[2] || 'up';

runCommand(command);