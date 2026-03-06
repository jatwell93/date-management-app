import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { UploadService } from '../services/upload.service';
import { getDefaultDatabaseClient } from '../database/database-factory';

export class UploadController {
  constructor(private uploadService: UploadService) {}

  /**
   * Initiate upload: determine strategy (Direct vs Presigned)
   */
  async initiate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { filename, fileSize, contentType } = req.body;

      if (!filename || !fileSize || !contentType) {
        res.status(400).json({ error: 'Missing required fields: filename, fileSize, contentType' });
        return;
      }

      const result = await this.uploadService.initiateUpload(
        filename,
        Number(fileSize),
        contentType,
      );
      res.json(result);
    } catch (error) {
      console.error('Initiate upload error:', error);
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

      if (!buffer) {
        // Fallback if disk storage is used by mistake or misconfiguration
        res.status(500).json({ error: 'File buffer not available. Check server configuration.' });
        return;
      }

      await this.uploadService.handleDirectUpload(buffer, originalname, mimetype, req.userId);

      res.json({ message: 'File uploaded and processing started' });
    } catch (error) {
      console.error('Direct upload error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * Complete upload (after presigned PUT)
   */
  async complete(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'User authentication required' });
        return;
      }

      const { key } = req.body;

      if (!key) {
        res.status(400).json({ error: 'Missing required field: key' });
        return;
      }

      await this.uploadService.completeUpload(key, req.userId);
      res.json({ message: 'Upload completed and processing started' });
    } catch (error) {
      console.error('Complete upload error:', error);
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

      // Query upload status from database
      const prisma = getDefaultDatabaseClient();
      const upload = await prisma.upload.findUnique({
        where: { fileKey: key },
        select: {
          status: true,
          uploadProgress: true,
          processingMessage: true,
          errorMessage: true,
          rowsProcessed: true,
          rowsTotal: true,
          organizationId: true,
        },
      });

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

      res.json({
        status: upload.status,
        progress,
        message: upload.processingMessage,
        error: upload.errorMessage,
        rowsProcessed: upload.rowsProcessed,
        rowsTotal: upload.rowsTotal,
      });
    } catch (error) {
      console.error('Upload status error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}
