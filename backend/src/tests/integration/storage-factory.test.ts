/**
 * Integration Tests for Storage Factory
 *
 * Tests environment-based provider switching and configuration.
 */

import * as path from 'path';
import {
  createStorageProvider,
  getStorageProviderType,
  getDefaultStorageProvider,
  resetDefaultStorageProvider,
} from '../../storage/storage-factory';
import { LocalStorageProvider } from '../../storage/local-storage.provider';
import { R2StorageProvider } from '../../storage/r2-storage.provider';

// Store original env
const originalEnv = process.env;

describe('StorageFactory', () => {
  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    resetDefaultStorageProvider();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
    resetDefaultStorageProvider();
  });

  describe('createStorageProvider', () => {
    describe('development environment', () => {
      it('should create LocalStorageProvider when NODE_ENV is development', () => {
        process.env.NODE_ENV = 'development';

        const provider = createStorageProvider();

        expect(provider).toBeInstanceOf(LocalStorageProvider);
      });

      it('should create LocalStorageProvider when NODE_ENV is undefined', () => {
        delete process.env.NODE_ENV;

        const provider = createStorageProvider();

        expect(provider).toBeInstanceOf(LocalStorageProvider);
      });

      it('should use custom local base path when provided', () => {
        process.env.NODE_ENV = 'development';
        const customPath = path.join(__dirname, 'custom-uploads');

        const provider = createStorageProvider({
          localBasePath: customPath,
        });

        expect(provider).toBeInstanceOf(LocalStorageProvider);
      });
    });

    describe('test environment', () => {
      it('should create LocalStorageProvider when NODE_ENV is test', () => {
        process.env.NODE_ENV = 'test';

        const provider = createStorageProvider();

        expect(provider).toBeInstanceOf(LocalStorageProvider);
      });
    });

    describe('production environment', () => {
      it('should create R2StorageProvider when NODE_ENV is production with valid config', () => {
        process.env.NODE_ENV = 'production';
        process.env.R2_ACCOUNT_ID = 'test-account';
        process.env.R2_ACCESS_KEY_ID = 'test-access-key';
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
        process.env.R2_BUCKET_NAME = 'test-bucket';

        const provider = createStorageProvider();

        expect(provider).toBeInstanceOf(R2StorageProvider);
      });

      it('should throw error when R2 config is incomplete', () => {
        process.env.NODE_ENV = 'production';
        // Missing R2 credentials

        expect(() => createStorageProvider()).toThrow('R2 storage configuration is incomplete');
      });

      it('should throw error when only some R2 credentials are present', () => {
        process.env.NODE_ENV = 'production';
        process.env.R2_ACCOUNT_ID = 'test-account';
        // Missing other credentials

        expect(() => createStorageProvider()).toThrow('R2 storage configuration is incomplete');
      });

      it('should use config parameters over environment variables', () => {
        process.env.NODE_ENV = 'production';
        process.env.R2_ACCOUNT_ID = 'env-account';
        process.env.R2_ACCESS_KEY_ID = 'env-access-key';
        process.env.R2_SECRET_ACCESS_KEY = 'env-secret';
        process.env.R2_BUCKET_NAME = 'env-bucket';

        const provider = createStorageProvider({
          r2AccountId: 'config-account',
          r2AccessKeyId: 'config-access-key',
          r2SecretAccessKey: 'config-secret',
          r2BucketName: 'config-bucket',
        });

        expect(provider).toBeInstanceOf(R2StorageProvider);
      });
    });

    describe('explicit environment override', () => {
      it('should use explicit environment over NODE_ENV', () => {
        process.env.NODE_ENV = 'production';

        const provider = createStorageProvider({
          environment: 'development',
        });

        expect(provider).toBeInstanceOf(LocalStorageProvider);
      });

      it('should create R2 provider when environment is explicitly production', () => {
        process.env.NODE_ENV = 'development';
        process.env.R2_ACCOUNT_ID = 'test-account';
        process.env.R2_ACCESS_KEY_ID = 'test-access-key';
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
        process.env.R2_BUCKET_NAME = 'test-bucket';

        const provider = createStorageProvider({
          environment: 'production',
        });

        expect(provider).toBeInstanceOf(R2StorageProvider);
      });
    });
  });

  describe('getStorageProviderType', () => {
    it('should return LocalStorageProvider for development', () => {
      process.env.NODE_ENV = 'development';

      const type = getStorageProviderType();

      expect(type).toBe('LocalStorageProvider');
    });

    it('should return R2StorageProvider for production', () => {
      process.env.NODE_ENV = 'production';

      const type = getStorageProviderType();

      expect(type).toBe('R2StorageProvider');
    });

    it('should respect explicit environment config', () => {
      process.env.NODE_ENV = 'development';

      const type = getStorageProviderType({ environment: 'production' });

      expect(type).toBe('R2StorageProvider');
    });
  });

  describe('getDefaultStorageProvider (singleton)', () => {
    it('should return the same instance on multiple calls', () => {
      process.env.NODE_ENV = 'development';

      const provider1 = getDefaultStorageProvider();
      const provider2 = getDefaultStorageProvider();

      expect(provider1).toBe(provider2);
    });

    it('should create new instance after reset', () => {
      process.env.NODE_ENV = 'development';

      const provider1 = getDefaultStorageProvider();
      resetDefaultStorageProvider();
      const provider2 = getDefaultStorageProvider();

      expect(provider1).not.toBe(provider2);
    });
  });

  describe('resetDefaultStorageProvider', () => {
    it('should clear the singleton provider', () => {
      process.env.NODE_ENV = 'development';

      const provider1 = getDefaultStorageProvider();
      resetDefaultStorageProvider();

      // Change environment
      process.env.NODE_ENV = 'test';
      const provider2 = getDefaultStorageProvider();

      // Should get a new instance (potentially different config)
      expect(provider1).not.toBe(provider2);
    });
  });
});
