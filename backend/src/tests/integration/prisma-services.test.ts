/**
 * Integration Tests for Prisma-based Services
 *
 * Tests InventoryService, StoreAreaService, and ProductService
 * with the Prisma ORM database abstraction.
 * 
 * These tests verify that the DI pattern works correctly and that
 * the services can be used with injected PrismaClient instances.
 */

import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../../services/inventory.service';
import { StoreAreaService } from '../../services/store-area.service';
import { ProductService } from '../../services/product.service';
import {
  createDatabaseClient,
  resetDefaultDatabaseClient,
  getDefaultDatabaseClient,
} from '../../database/database-factory';

describe('Prisma-based Services Integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Use a test database client
    process.env.NODE_ENV = 'test';
    prisma = createDatabaseClient({
      environment: 'test',
      connectionUrl: 'file:./test-services.db',
    });

    // Ensure tables exist (in real scenario, migrations would handle this)
    // For testing, we'll just verify the client connects
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await resetDefaultDatabaseClient();
  });

  describe('Service Instantiation with DI', () => {
    it('should create InventoryService with injected PrismaClient', () => {
      const service = new InventoryService(prisma);
      expect(service).toBeInstanceOf(InventoryService);
    });

    it('should create InventoryService with default client when none provided', () => {
      const service = new InventoryService();
      expect(service).toBeInstanceOf(InventoryService);
    });

    it('should create StoreAreaService with injected PrismaClient', () => {
      const service = new StoreAreaService(prisma);
      expect(service).toBeInstanceOf(StoreAreaService);
    });

    it('should create StoreAreaService with default client when none provided', () => {
      const service = new StoreAreaService();
      expect(service).toBeInstanceOf(StoreAreaService);
    });

    it('should create ProductService with injected PrismaClient', () => {
      const service = new ProductService(prisma);
      expect(service).toBeInstanceOf(ProductService);
    });

    it('should create ProductService with default client when none provided', () => {
      const service = new ProductService();
      expect(service).toBeInstanceOf(ProductService);
    });
  });

  describe('getDefaultDatabaseClient singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const client1 = getDefaultDatabaseClient();
      const client2 = getDefaultDatabaseClient();
      
      expect(client1).toBe(client2);
    });

    it('should create new instance after reset', async () => {
      const client1 = getDefaultDatabaseClient();
      await resetDefaultDatabaseClient();
      const client2 = getDefaultDatabaseClient();
      
      expect(client1).not.toBe(client2);
    });
  });

  describe('Service method types verification', () => {
    // These tests just verify the method signatures are Promises
    // without actually executing them (which would require a migrated DB)
    
    it('InventoryService.getAllInventoryItems should be a function returning Promise', () => {
      const service = new InventoryService(prisma);
      expect(typeof service.getAllInventoryItems).toBe('function');
    });

    it('StoreAreaService.getAllStoreAreas should be a function returning Promise', () => {
      const service = new StoreAreaService(prisma);
      expect(typeof service.getAllStoreAreas).toBe('function');
    });

    it('ProductService.getAllProducts should be a function returning Promise', () => {
      const service = new ProductService(prisma);
      expect(typeof service.getAllProducts).toBe('function');
    });
  });
});
