import { Request, Response } from 'express';
import { DatabaseBackupService } from '../services/database.backup.service';
import { Logger } from '../utils/logger';

const backupService = new DatabaseBackupService();

export const createBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const backupPath = await backupService.createBackup();

    res.status(200).json({
      message: 'Database backup created successfully',
      backupPath: backupPath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Error creating database backup', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Failed to create database backup',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};

export const restoreBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupPath } = req.body;

    if (!backupPath) {
      res.status(400).json({
        error: 'Backup path is required',
      });
      return;
    }

    const success = await backupService.restoreFromBackup(backupPath);

    if (success) {
      res.status(200).json({
        message: 'Database restored successfully',
        backupPath: backupPath,
      });
    } else {
      res.status(400).json({
        error: 'Failed to restore database from backup',
      });
    }
  } catch (error) {
    Logger.error('Error restoring database backup', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Failed to restore database from backup',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};

export const listBackups = async (req: Request, res: Response): Promise<void> => {
  try {
    const backups = await backupService.listBackups();

    res.status(200).json({
      backups: backups,
      count: backups.length,
    });
  } catch (error) {
    Logger.error('Error listing database backups', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Failed to list database backups',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};
