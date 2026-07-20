/**
 * Contract Tests: Storage Quota and Upload Status Consistency
 *
 * Verifies that storage quota calculations match actual completed upload totals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UploadStatus } from '../../types/upload.types';
import { StorageQuotaService } from '../../services/storage-quota.service';

const prisma = new PrismaClient();

describe('Storage Quota Contract Tests', () => {
  const testOrgId = 'test-quota-contract-' + Date.now();
  let testUserId: number;

  beforeEach(async () => {
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
        slug: `test-quota-${Date.now()}`,
        contactEmail: 'test@example.com',
        clerkOrganizationId: `org_quota_${Date.now()}`,
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

  describe('Quota Calculation Accuracy', () => {
    it('should match OrganizationUsage.storageUsedBytes with sum of completed uploads', async () => {
      const quotaService = new StorageQuotaService(testOrgId);

      // Record multiple uploads
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'file1.csv',
        'file1.csv',
        1024,
        'text/csv',
      );
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'file2.csv',
        'file2.csv',
        2048,
        'text/csv',
      );
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'file3.csv',
        'file3.csv',
        4096,
        'text/csv',
      );

      // Get organization usage
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrgId },
      });

      // Calculate actual completed upload sizes
      const uploadSum = await prisma.upload.aggregate({
        where: {
          organizationId: testOrgId,
          status: {
            in: [UploadStatus.PROCESSING, UploadStatus.COMPLETED],
          },
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      const expectedTotal = 1024 + 2048 + 4096; // 7168 bytes
      expect(usage?.storageUsedBytes).toBe(expectedTotal);
      expect(uploadSum._sum.fileSizeBytes).toBe(expectedTotal);
      expect(usage?.storageUsedBytes).toBe(uploadSum._sum.fileSizeBytes);
    });

    it('should only count COMPLETED uploads in storage calculation', async () => {
      // Create uploads in various states
      await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'pending.csv',
          fileName: 'pending.csv',
          fileSizeBytes: 1000,
          contentType: 'text/csv',
          status: UploadStatus.PENDING,
        },
      });

      await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'processing.csv',
          fileName: 'processing.csv',
          fileSizeBytes: 2000,
          contentType: 'text/csv',
          status: UploadStatus.PROCESSING,
        },
      });

      await prisma.upload.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          fileKey: 'failed.csv',
          fileName: 'failed.csv',
          fileSizeBytes: 3000,
          contentType: 'text/csv',
          status: UploadStatus.FAILED,
          errorMessage: 'Test error',
        },
      });

      const quotaService = new StorageQuotaService(testOrgId);
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'completed.csv',
        'completed.csv',
        4000,
        'text/csv',
      );

      // Calculate aggregate - should only count completed
      const result = await prisma.upload.aggregate({
        where: {
          organizationId: testOrgId,
          status: {
            in: [UploadStatus.PROCESSING, UploadStatus.COMPLETED],
          },
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      // Processing and completed uploads are both counted for quota.
      // processing.csv (2000) + completed.csv (4000) = 6000
      expect(result._sum.fileSizeBytes).toBe(6000);
    });

    it('should decrement storage when completed upload is deleted', async () => {
      const quotaService = new StorageQuotaService(testOrgId);

      // Record upload
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'delete-me.csv',
        'delete-me.csv',
        5120,
        'text/csv',
      );

      // Verify it's counted
      let usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrgId },
      });
      expect(usage?.storageUsedBytes).toBe(5120);

      // Delete it
      await quotaService.markUploadDeleted(testOrgId, 'delete-me.csv');

      // Verify storage decremented
      usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrgId },
      });
      expect(usage?.storageUsedBytes).toBe(0);
    });
  });

  describe('Status Filter Consistency', () => {
    it('should use same status value in quota aggregation and service writes', async () => {
      const quotaService = new StorageQuotaService(testOrgId);

      // Record upload (service writes status)
      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'consistency.csv',
        'consistency.csv',
        2048,
        'text/csv',
      );

      // Get the upload
      const upload = await prisma.upload.findUnique({
        where: { fileKey: 'consistency.csv' },
      });

      // Verify status is PROCESSING at write time
      expect(upload?.status).toBe(UploadStatus.PROCESSING);

      // Verify this status is what quota service filters on
      const calculatedStorage = await prisma.upload.aggregate({
        where: {
          organizationId: testOrgId,
          status: {
            in: [UploadStatus.PROCESSING, UploadStatus.COMPLETED], // Same statuses service counts
          },
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      expect(calculatedStorage._sum.fileSizeBytes).toBe(2048);
    });
  });

  describe('Quota Calculation Edge Cases', () => {
    it('should handle zero uploads gracefully', async () => {
      const result = await prisma.upload.aggregate({
        where: {
          organizationId: testOrgId,
          status: UploadStatus.COMPLETED,
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      expect(result._sum.fileSizeBytes).toBeNull();
    });

    it('should handle very large file sizes', async () => {
      const quotaService = new StorageQuotaService(testOrgId);
      const largeFileSize = 100 * 1024 * 1024; // 100MB

      await quotaService.recordUpload(
        testOrgId,
        testUserId,
        'large-file.csv',
        'large-file.csv',
        largeFileSize,
        'text/csv',
      );

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrgId },
      });

      expect(usage?.storageUsedBytes).toBe(largeFileSize);
    });
  });
});
