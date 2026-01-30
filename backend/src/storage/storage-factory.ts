/**
 * Storage Factory
 *
 * Creates the appropriate storage provider based on the environment.
 * - Development: LocalStorageProvider (filesystem)
 * - Production: R2StorageProvider (Cloudflare R2)
 */

import * as path from 'path';
import { StorageProvider } from './storage-provider.interface';
import { LocalStorageProvider } from './local-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';

export type StorageEnvironment = 'development' | 'production' | 'test';

export interface StorageFactoryConfig {
  environment?: StorageEnvironment;
  // Local storage options
  localBasePath?: string;
  // R2 storage options
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  // Common options
  maxFileSizeBytes?: number;
}

/**
 * Detect the current environment from NODE_ENV
 */
function detectEnvironment(): StorageEnvironment {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();

  if (nodeEnv === 'production') {
    return 'production';
  }
  if (nodeEnv === 'test') {
    return 'test';
  }
  return 'development';
}

/**
 * Get default local storage path based on environment
 */
function getDefaultLocalPath(environment: StorageEnvironment): string {
  const projectRoot = process.cwd();

  if (environment === 'test') {
    return path.join(projectRoot, 'test-uploads');
  }
  return path.join(projectRoot, 'uploads');
}

/**
 * Create a storage provider based on configuration and environment
 */
export function createStorageProvider(config: StorageFactoryConfig = {}): StorageProvider {
  const environment = config.environment ?? detectEnvironment();

  // In production, use R2 storage
  if (environment === 'production') {
    const accountId = config.r2AccountId ?? process.env.R2_ACCOUNT_ID;
    const accessKeyId = config.r2AccessKeyId ?? process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = config.r2SecretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = config.r2BucketName ?? process.env.R2_BUCKET_NAME;

    // Validate required R2 configuration
    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error(
        'R2 storage configuration is incomplete. Required environment variables: ' +
          'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME',
      );
    }

    return new R2StorageProvider({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      maxFileSizeBytes: config.maxFileSizeBytes,
    });
  }

  // In development or test, use local storage
  const basePath = config.localBasePath ?? getDefaultLocalPath(environment);

  return new LocalStorageProvider({
    basePath,
    maxFileSizeBytes: config.maxFileSizeBytes,
  });
}

/**
 * Get the storage provider type name for logging/debugging
 */
export function getStorageProviderType(config: StorageFactoryConfig = {}): string {
  const environment = config.environment ?? detectEnvironment();
  return environment === 'production' ? 'R2StorageProvider' : 'LocalStorageProvider';
}

// Export a default singleton instance for convenience
let defaultProvider: StorageProvider | null = null;

/**
 * Get the default storage provider (singleton)
 * Creates the provider on first call based on environment
 */
export function getDefaultStorageProvider(): StorageProvider {
  if (!defaultProvider) {
    defaultProvider = createStorageProvider();
  }
  return defaultProvider;
}

/**
 * Reset the default provider (useful for testing)
 */
export function resetDefaultStorageProvider(): void {
  defaultProvider = null;
}
