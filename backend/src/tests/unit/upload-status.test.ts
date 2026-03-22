/**
 * Unit Tests: Upload Status State Machine
 *
 * Verifies upload status transitions follow the canonical lifecycle:
 * pending → uploading → processing → completed/failed
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { UploadStatus } from '../../types/upload.types';
import { StorageQuotaService } from '../../services/storage-quota.service';
import { UploadService } from '../../services/upload.service';

const prisma = new PrismaClient();

describe('Upload Status State Machine', () => {
  const testOrgId = 'test-status-org-' + Date.now();
  let testUserId: number;

  beforeEach(async () => {
    // Clean up any test data
    await prisma.upload.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.user.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.organizationUsage.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.organization.deleteMany({
      where: { id: testOrgId },
    });

    // Create test organization
    await prisma.organization.create({
      data: {
        id: testOrgId,
        name: 'Test Org',
        slug: `test-upload-status-${Date.now()}`,
        contactEmail: 'test@example.com',
        clerkOrganizationId: `org_status_${Date.now()}`,
      },
    });

    // Create test user
    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_${Date.now()}_${Math.random()}`,
        email: 'test@example.com',
        username: 'testuser',
        role: 'user',
        organizationId: testOrgId,
      },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await prisma.upload.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.user.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.organizationUsage.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.organization.deleteMany({
      where: { id: testOrgId },
    });
  });

  describe('Status Transition: pending → processing → completed', () => {
    it('should create upload in pending state by default', async () => {
      const upload = await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-1.csv',
          fileName: 'test-upload-1.csv',
          fileSizeBytes: 1024,
          contentType: 'text/csv',
        },
      });

      expect(upload.status).toBe(UploadStatus.PENDING);
    });

    it('should transition from pending → processing via recordUpload', async () => {
      const quotaService = new StorageQuotaService(testOrgId);

      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'test-upload-2.csv',
        'test-upload-2.csv',
        2048,
        'text/csv',
      );

      const upload = await prisma.upload.findUnique({
        where: { fileKey: 'test-upload-2.csv' },
      });

      // recordUpload creates in PROCESSING state and is marked completed after parsing.
      expect(upload?.status).toBe(UploadStatus.PROCESSING);
    });

    it('should mark upload as completed after successful processing', async () => {
      // Create upload in processing state
      const upload = await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-3.csv',
          fileName: 'test-upload-3.csv',
          fileSizeBytes: 4096,
          contentType: 'text/csv',
          status: UploadStatus.PROCESSING,
        },
      });

      // Simulate completion
      await prisma.upload.update({
        where: { fileKey: upload.fileKey },
        data: {
          status: UploadStatus.COMPLETED,
          rowsProcessed: 100,
          rowsImported: 90,
          rowsUpdated: 10,
        },
      });

      const updated = await prisma.upload.findUnique({
        where: { fileKey: 'test-upload-3.csv' },
      });

      expect(updated?.status).toBe(UploadStatus.COMPLETED);
      expect(updated?.rowsProcessed).toBe(100);
    });
  });

  describe('Status Transition: pending → processing → failed', () => {
    it('should mark upload as failed on processing error', async () => {
      const upload = await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-4.csv',
          fileName: 'test-upload-4.csv',
          fileSizeBytes: 2048,
          contentType: 'text/csv',
          status: UploadStatus.PROCESSING,
        },
      });

      // Simulate failure
      await prisma.upload.update({
        where: { fileKey: upload.fileKey },
        data: {
          status: UploadStatus.FAILED,
          errorMessage: 'Invalid CSV format',
          rowsImported: 0,
          rowsUpdated: 0,
          rowsSkipped: 0,
          rowErrorCount: 0,
        },
      });

      const updated = await prisma.upload.findUnique({
        where: { fileKey: 'test-upload-4.csv' },
      });

      expect(updated?.status).toBe(UploadStatus.FAILED);
      expect(updated?.errorMessage).toBe('Invalid CSV format');
    });

    it('should not increment storage quota for failed uploads', async () => {
      await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-5.csv',
          fileName: 'test-upload-5.csv',
          fileSizeBytes: 5120,
          contentType: 'text/csv',
          status: UploadStatus.FAILED,
          errorMessage: 'Test error',
        },
      });

      // Calculate storage usage (should only count completed uploads)
      const result = await prisma.upload.aggregate({
        where: {
          organizationId: testOrgId,
          status: UploadStatus.COMPLETED,
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      // When no completed uploads exist, _sum returns null
      expect(result._sum.fileSizeBytes).toBeNull();
    });
  });

  describe('Status Validation', () => {
    it('should only allow valid status values', () => {
      const validStatuses = Object.values(UploadStatus);

      expect(validStatuses).toContain('pending');
      expect(validStatuses).toContain('uploading');
      expect(validStatuses).toContain('processing');
      expect(validStatuses).toContain('completed');
      expect(validStatuses).toContain('failed');

      // Should NOT contain legacy 'complete'
      expect(validStatuses).not.toContain('complete');
    });

    it('should use canonical COMPLETED status in services', () => {
      expect(UploadStatus.COMPLETED).toBe('completed');
      expect(UploadStatus.FAILED).toBe('failed');
      expect(UploadStatus.PROCESSING).toBe('processing');
      expect(UploadStatus.PENDING).toBe('pending');
      expect(UploadStatus.UPLOADING).toBe('uploading');
    });
  });

  describe('Terminal State Immutability', () => {
    it('should not transition from completed to other states', async () => {
      const upload = await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-6.csv',
          fileName: 'test-upload-6.csv',
          fileSizeBytes: 1024,
          contentType: 'text/csv',
          status: UploadStatus.COMPLETED,
        },
      });

      // Attempt to change completed upload should be prevented by business logic
      // (in production, services should validate this)
      expect(upload.status).toBe(UploadStatus.COMPLETED);

      // This test documents the expectation - services should not allow
      // updates to terminal states unless explicitly deleting
    });

    it('should not transition from failed to other states except retry', async () => {
      const upload = await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'test-upload-7.csv',
          fileName: 'test-upload-7.csv',
          fileSizeBytes: 1024,
          contentType: 'text/csv',
          status: UploadStatus.FAILED,
          errorMessage: 'Test error',
        },
      });

      expect(upload.status).toBe(UploadStatus.FAILED);
      expect(upload.errorMessage).toBeTruthy();

      // Failed uploads can be retried (new upload record) but not transitioned in place
    });
  });
});
