import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Logger } from '../utils/logger';
import { UploadService } from '../services/upload.service';
import { UploadImportType } from '../types/upload.types';
import { UploadRepository } from '../repositories/upload.repository';

export class UploadController {
  constructor(
    private uploadService: UploadService,
    private uploadRepository: UploadRepository,
  ) { }

  /**
   * Initiate upload: determine strategy (Direct vs Presigned)
   */
  async initiate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { filename, fileSize, contentType, importType } = req.body;

      if (!filename || !fileSize || !contentType) {
        res.status(400).json({ error: 'Missing required fields: filename, fileSize, contentType' });
        return;
      }

      const result = importType
        ? await this.uploadService.initiateUpload(
          filename,
          Number(fileSize),
          contentType,
          importType,
        )
        : await this.uploadService.initiateUpload(filename, Number(fileSize), contentType);
      res.json(result);
    } catch (error) {
      Logger.error('Initiate upload error', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.message.includes('exceeds maximum')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * Handle direct upload (file passed in req.file by multer)
   */
  async direct(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'User authentication required' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // We assume route middleware (Multer memory storage) puts file buffer in req.file.buffer
      const { originalname, mimetype, buffer } = req.file;
      const importType = req.body?.importType;

      if (!buffer) {
        // Fallback if disk storage is used by mistake or misconfiguration
        res.status(500).json({ error: 'File buffer not available. Check server configuration.' });
        return;
      }

      const uploadResult = importType
        ? await this.uploadService.handleDirectUpload(
          buffer,
          originalname,
          mimetype,
          req.userId,
          importType,
        )
        : await this.uploadService.handleDirectUpload(buffer, originalname, mimetype, req.userId);

      const normalizedResult =
        typeof uploadResult === 'string'
          ? { key: uploadResult, processingResult: undefined }
          : uploadResult;

      if (importType === UploadImportType.EXPIRY_LIST && normalizedResult.processingResult) {
        const { processingResult } = normalizedResult;
        res.json({
          message: 'File uploaded and processing started',
          key: normalizedResult.key,
          importedCount: processingResult.importedCount,
          mergedCount: processingResult.updatedCount,
          rejectedCount: processingResult.skippedCount,
          ...(processingResult.rejectedRows
            ? { rejectedRows: processingResult.rejectedRows }
            : { rejectedRows: [] }),
        });
        return;
      }

      res.json({ message: 'File uploaded and processing started', key: normalizedResult.key });
    } catch (error) {
      Logger.error('Direct upload error', { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * Complete upload (after presigned PUT)
   */
  async complete(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.userId || !req.organizationId) {
        res.status(401).json({ error: 'User authentication required' });
        return;
      }

      const { key, importType } = req.body;

      if (!key) {
        res.status(400).json({ error: 'Missing required field: key' });
        return;
      }

      const processingResult = importType
        ? await this.uploadService.completeUpload(key, req.userId, importType)
        : await this.uploadService.completeUpload(key, req.userId);

      if (importType === UploadImportType.EXPIRY_LIST && processingResult) {
        res.json({
          message: 'Upload completed and processing started',
          importedCount: processingResult.importedCount,
          mergedCount: processingResult.updatedCount,
          rejectedCount: processingResult.skippedCount,
          ...(processingResult.rejectedRows
            ? { rejectedRows: processingResult.rejectedRows }
            : { rejectedRows: [] }),
        });
        return;
      }

      res.json({ message: 'Upload completed and processing started' });
    } catch (error) {
      Logger.error('Complete upload error', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.message.startsWith('Access denied:')) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * Get upload status (for progress tracking)
   */
  async status(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.userId || !req.organizationId) {
        res.status(401).json({ error: 'User authentication required' });
        return;
      }

      const { key } = req.params;

      if (!key) {
        res.status(400).json({ error: 'Missing required parameter: key' });
        return;
      }

      // Decode URL-encoded key (handles keys with slashes)
      const decodedKey = decodeURIComponent(key);

      const upload = await this.uploadRepository.findStatusByFileKey(decodedKey);

      if (!upload) {
        res.status(404).json({ error: 'Upload not found' });
        return;
      }

      // Security: Verify upload belongs to  user's organization
      if (upload.organizationId !== req.organizationId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Calculate progress percentage
      let progress = upload.uploadProgress;
      if (upload.rowsTotal && upload.rowsTotal > 0) {
        progress = Math.min(100, Math.floor((upload.rowsProcessed / upload.rowsTotal) * 100));
      }

      // Parse column data safely (handle malformed JSON in DB)
      let columnsUsedData: unknown;
      if (upload.columnsUsed) {
        try {
          columnsUsedData = JSON.parse(upload.columnsUsed);
        } catch (parseError) {
          Logger.warn('Failed to parse upload.columnsUsed', { error: parseError instanceof Error ? parseError.message : String(parseError) });
          // Return empty array as fallback for malformed JSON
          columnsUsedData = undefined;
        }
      }

      res.json({
        status: upload.status,
        progress,
        message: upload.processingMessage,
        error: upload.errorMessage,
        rowsProcessed: upload.rowsProcessed,
        rowsTotal: upload.rowsTotal,
        importedCount: upload.rowsImported,
        mergedCount: upload.rowsUpdated,
        updatedCount: upload.rowsUpdated,
        rejectedCount: upload.rowsSkipped,
        skippedCount: upload.rowsSkipped,
        errorCount: upload.rowErrorCount,
        columnsUsed: columnsUsedData,
        columnsIgnored: upload.columnsIgnored,
      });
    } catch (error) {
      Logger.error('Upload status error', { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}
