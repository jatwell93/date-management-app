/**
 * Unit Tests for Storage Factory
 */

import {
  createStorageProvider,
  getStorageProviderType,
  resetDefaultStorageProvider,
} from '../../storage/storage-factory';
import { LocalStorageProvider } from '../../storage/local-storage.provider';
import { R2StorageProvider } from '../../storage/r2-storage.provider';

const originalEnv = process.env;

describe('StorageFactory (unit)', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDefaultStorageProvider();
  });

  afterAll(() => {
    process.env = originalEnv;
    resetDefaultStorageProvider();
  });

  it('creates LocalStorageProvider with default test path', () => {
    process.env.NODE_ENV = 'test';

    const provider = createStorageProvider();

    expect(provider).toBeInstanceOf(LocalStorageProvider);
    expect((provider as any).basePath).toContain('test-uploads');
  });

  it('creates LocalStorageProvider with explicit base path', () => {
    process.env.NODE_ENV = 'development';

    const provider = createStorageProvider({ localBasePath: 'custom-uploads' });

    expect(provider).toBeInstanceOf(LocalStorageProvider);
    expect((provider as any).basePath).toContain('custom-uploads');
  });

  it('throws when production R2 config is missing', () => {
    process.env.NODE_ENV = 'production';

    expect(() => createStorageProvider()).toThrow('R2 storage configuration is incomplete');
  });

  it('creates R2StorageProvider when production config provided', () => {
    process.env.NODE_ENV = 'production';

    const provider = createStorageProvider({
      r2AccountId: 'test-account',
      r2AccessKeyId: 'test-access',
      r2SecretAccessKey: 'test-secret',
      r2BucketName: 'test-bucket',
    });

    expect(provider).toBeInstanceOf(R2StorageProvider);
  });

  it('returns provider type names for logging', () => {
    process.env.NODE_ENV = 'development';
    expect(getStorageProviderType()).toBe('LocalStorageProvider');

    process.env.NODE_ENV = 'production';
    expect(getStorageProviderType()).toBe('R2StorageProvider');
  });
});
