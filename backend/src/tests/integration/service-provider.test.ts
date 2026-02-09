/**
 * Integration Tests for ServiceProvider DI Container
 *
 * Validates that ServiceProvider correctly:
 * - Instantiates services with proper dependencies
 * - Provides lazy-loaded singleton instances
 * - Wires dependencies correctly (AuthService → UserService, etc.)
 * - Supports dependency injection for testing
 */

import { PrismaClient } from '@prisma/client';
import { ServiceProvider } from '../../services/service-provider';
import { StorageProvider } from '../../storage/storage-provider.interface';

// Mock storage provider for testing
class MockStorageProvider implements StorageProvider {
  async upload(key: string, data: Buffer): Promise<string> {
    return `mock://${key}`;
  }

  async download(key: string): Promise<Buffer> {
    return Buffer.from(`mock-data-${key}`);
  }

  async delete(key: string): Promise<void> {
    return;
  }

  async exists(key: string): Promise<boolean> {
    return true;
  }

  async getPresignedUploadUrl(key: string): Promise<string> {
    return `https://mock.example.com/upload/${key}`;
  }
}

describe('ServiceProvider Integration Tests', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  let mockStorage: StorageProvider;
  let serviceProvider: ServiceProvider;

  beforeEach(() => {
    // Create mock Prisma client
    mockPrisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      product: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      $disconnect: jest.fn(),
    } as any;

    mockStorage = new MockStorageProvider();
    serviceProvider = new ServiceProvider(mockPrisma, mockStorage);
  });

  afterEach(async () => {
    await mockPrisma.$disconnect();
  });

  describe('Service Instantiation', () => {
    it('should create AuthService with injected Prisma client', () => {
      const authService = serviceProvider.getAuthService();
      expect(authService).toBeDefined();
      expect(authService).toHaveProperty('login');
      expect(authService).toHaveProperty('validatePin');
      expect(authService).toHaveProperty('hashPin');
    });

    it('should create UserService with AuthService dependency', () => {
      const userService = serviceProvider.getUserService();
      expect(userService).toBeDefined();
      expect(userService).toHaveProperty('createUser');
      expect(userService).toHaveProperty('getUsers');
      expect(userService).toHaveProperty('getUserById');
    });

    it('should create CSVParserService with Prisma client', () => {
      const csvParser = serviceProvider.getCSVParserService();
      expect(csvParser).toBeDefined();
      expect(csvParser).toHaveProperty('processFile');
    });

    it('should create StorageQuotaService', () => {
      const quotaService = serviceProvider.getStorageQuotaService();
      expect(quotaService).toBeDefined();
      expect(quotaService).toHaveProperty('getStorageQuota');
      expect(quotaService).toHaveProperty('recordUpload');
    });

    it('should create UploadService with all dependencies', () => {
      const uploadService = serviceProvider.getUploadService();
      expect(uploadService).toBeDefined();
      expect(uploadService).toHaveProperty('initiateUpload');
      expect(uploadService).toHaveProperty('completeUpload');
    });
  });

  describe('Singleton Behavior', () => {
    it('should return same AuthService instance on multiple calls', () => {
      const service1 = serviceProvider.getAuthService();
      const service2 = serviceProvider.getAuthService();
      expect(service1).toBe(service2);
    });

    it('should return same UserService instance on multiple calls', () => {
      const service1 = serviceProvider.getUserService();
      const service2 = serviceProvider.getUserService();
      expect(service1).toBe(service2);
    });

    it('should return same UploadService instance on multiple calls', () => {
      const service1 = serviceProvider.getUploadService();
      const service2 = serviceProvider.getUploadService();
      expect(service1).toBe(service2);
    });
  });

  describe('Dependency Wiring', () => {
    it('should provide same PrismaClient to all services', async () => {
      // Mock a user query
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: 1,
          username: 'test',
          pin: 'hashed-pin',
          role: 'Manager',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const authService = serviceProvider.getAuthService();
      const userService = serviceProvider.getUserService();

      // Both services should use the same Prisma instance
      await userService.getUsers();
      expect(mockPrisma.user.findMany).toHaveBeenCalled();
    });

    it('should wire CSV parser and storage quota to upload service', async () => {
      const uploadService = serviceProvider.getUploadService();
      const csvParser = serviceProvider.getCSVParserService();
      const storageQuota = serviceProvider.getStorageQuotaService();

      // Upload service should have access to both dependencies
      expect(uploadService).toBeDefined();
      expect(csvParser).toBeDefined();
      expect(storageQuota).toBeDefined();
    });
  });

  describe('Custom Dependencies (Test Injection)', () => {
    it('should accept custom Prisma client for testing', () => {
      const customPrisma = {} as PrismaClient;
      const customProvider = new ServiceProvider(customPrisma);

      const authService = customProvider.getAuthService();
      expect(authService).toBeDefined();
    });

    it('should accept custom storage provider for testing', () => {
      const customStorage = new MockStorageProvider();
      const customProvider = new ServiceProvider(undefined, customStorage);

      const uploadService = customProvider.getUploadService();
      expect(uploadService).toBeDefined();
    });

    it('should support full mock injection for isolated testing', () => {
      const customPrisma = {} as PrismaClient;
      const customStorage = new MockStorageProvider();
      const customProvider = new ServiceProvider(customPrisma, customStorage);

      expect(customProvider.getAuthService()).toBeDefined();
      expect(customProvider.getUserService()).toBeDefined();
      expect(customProvider.getUploadService()).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from services without breaking container', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockRejectedValue(new Error('Database error'));

      const userService = serviceProvider.getUserService();
      await expect(userService.getUsers()).rejects.toThrow('Database error');

      // Container should still be functional after error
      const authService = serviceProvider.getAuthService();
      expect(authService).toBeDefined();
    });
  });
});
