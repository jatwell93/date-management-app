import { getDb, releaseDb } from '../database';
import { Database } from 'sqlite';
import { copyFile, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger';
import { promisify } from 'util';

interface BackupConfig {
  backupDirectory: string;
  retentionDays: number;
  maxRetainedBackups: number;
}

export class DatabaseBackupService {
  private static readonly DEFAULT_CONFIG: BackupConfig = {
    backupDirectory: './backups',
    retentionDays: 30,
    maxRetainedBackups: 10
  };

  private config: BackupConfig;

  constructor(config?: Partial<BackupConfig>) {
    this.config = { ...DatabaseBackupService.DEFAULT_CONFIG, ...config };
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory(): void {
    if (!existsSync(this.config.backupDirectory)) {
      mkdirSync(this.config.backupDirectory, { recursive: true });
      Logger.info(`Created backup directory: ${this.config.backupDirectory}`);
    }
  }

  /**
   * Creates a backup of the database
   * @returns Path to the created backup file
   */
  async createBackup(): Promise<string> {
    // Since we're just copying the database file, we don't need to get a connection
    // The backup is a file-level copy
    
    try {
      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `backup-${timestamp}.sqlite`;
      const backupPath = join(this.config.backupDirectory, backupFileName);

      // Get the original database path from the environment or default
      const originalDbPath = process.env.DATABASE_PATH || './database.sqlite';

      // Copy the database file to the backup location
      await promisify(copyFile)(originalDbPath, backupPath);

      Logger.info(`Database backup created: ${backupPath}`);
      
      // Clean up old backups after creating a new one
      await this.cleanupOldBackups();
      
      return backupPath;
    } catch (error) {
      Logger.error('Failed to create database backup', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Restores the database from a backup file
   * @param backupPath Path to the backup file to restore from
   * @returns Boolean indicating success
   */
  async restoreFromBackup(backupPath: string): Promise<boolean> {
    try {
      // Validate backup file exists
      if (!existsSync(backupPath)) {
        Logger.error(`Backup file does not exist: ${backupPath}`);
        return false;
      }

      // Get the original database path from the environment or default
      const originalDbPath = process.env.DATABASE_PATH || './database.sqlite';

      // Copy the backup file back to the original location
      await promisify(copyFile)(backupPath, originalDbPath);

      Logger.info(`Database restored from backup: ${backupPath}`);
      
      return true;
    } catch (error) {
      Logger.error('Failed to restore database from backup', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        backupPath
      });
      throw error;
    }
  }

  /**
   * Lists all available backup files
   * @returns Array of backup file paths sorted by creation date (newest first)
   */
  listBackups(): string[] {
    try {
      if (!existsSync(this.config.backupDirectory)) {
        return [];
      }

      const files = readdirSync(this.config.backupDirectory);
      const backupFiles = files
        .filter(file => file.endsWith('.sqlite') && file.startsWith('backup-'))
        .map(file => join(this.config.backupDirectory, file))
        .sort((a, b) => {
          const statA = statSync(a);
          const statB = statSync(b);
          return statB.mtime.getTime() - statA.mtime.getTime(); // Sort by modification time, newest first
        });

      Logger.info(`Found ${backupFiles.length} backup files`);
      return backupFiles;
    } catch (error) {
      Logger.error('Failed to list backup files', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return [];
    }
  }

  /**
   * Cleans up old backup files based on retention policy
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      const allBackups = this.listBackups();

      // Remove backups older than retention days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      const oldBackups = allBackups.filter(backupPath => {
        const stats = statSync(backupPath);
        return stats.mtime < cutoffDate;
      });

      for (const oldBackup of oldBackups) {
        unlinkSync(oldBackup);
        Logger.info(`Deleted old backup: ${oldBackup}`);
      }

      // If we still have more than the max retained backups, remove the oldest ones
      if (allBackups.length - oldBackups.length > this.config.maxRetainedBackups) {
        const toDelete = allBackups
          .slice(this.config.maxRetainedBackups) // Get backups beyond the max retention
          .filter(backup => !oldBackups.includes(backup)); // Exclude ones we already deleted

        for (const backupToDelete of toDelete) {
          unlinkSync(backupToDelete);
          Logger.info(`Deleted backup beyond retention limit: ${backupToDelete}`);
        }
      }
    } catch (error) {
      Logger.error('Failed to clean up old backups', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }
}