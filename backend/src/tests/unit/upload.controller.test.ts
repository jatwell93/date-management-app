import { UploadController } from '../../controllers/upload.controller';

describe('UploadController', () => {
  const uploadService = {} as never;
  let uploadRepository: {
    findStatusByFileKey: jest.Mock;
  };
  let controller: UploadController;
  let res: {
    status: jest.Mock;
    json: jest.Mock;
  };

  beforeEach(() => {
    uploadRepository = {
      findStatusByFileKey: vi.fn(),
    };
    controller = new UploadController(uploadService, uploadRepository as never);
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  it('returns upload status from the repository for the authenticated organization', async () => {
    uploadRepository.findStatusByFileKey.mockResolvedValue({
      status: 'PROCESSING',
      uploadProgress: 25,
      processingMessage: 'Processing rows',
      errorMessage: null,
      rowsProcessed: 2,
      rowsTotal: 4,
      rowsImported: 1,
      rowsUpdated: 1,
      rowsSkipped: 0,
      rowErrorCount: 0,
      columnsUsed: '["sku"]',
      columnsIgnored: 2,
      organizationId: 'org-1',
    });

    await controller.status(
      {
        userId: 10,
        organizationId: 'org-1',
        params: { key: encodeURIComponent('uploads/org-1/file.csv') },
      } as never,
      res as never,
    );

    expect(uploadRepository.findStatusByFileKey).toHaveBeenCalledWith('uploads/org-1/file.csv');
    expect(res.json).toHaveBeenCalledWith({
      status: 'PROCESSING',
      progress: 50,
      message: 'Processing rows',
      error: null,
      rowsProcessed: 2,
      rowsTotal: 4,
      importedCount: 1,
      mergedCount: 1,
      updatedCount: 1,
      rejectedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      columnsUsed: ['sku'],
      columnsIgnored: 2,
    });
  });

  it('denies status access for another organization upload', async () => {
    uploadRepository.findStatusByFileKey.mockResolvedValue({
      organizationId: 'org-2',
    });

    await controller.status(
      {
        userId: 10,
        organizationId: 'org-1',
        params: { key: encodeURIComponent('uploads/org-2/file.csv') },
      } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
  });
});
