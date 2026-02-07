import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { UploadService } from '../services/upload.service';

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
}
