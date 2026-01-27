/**
 * Storage Module
 *
 * Exports storage abstraction layer for unified file operations
 * across development (local filesystem) and production (Cloudflare R2).
 */

// Interface and error types
export {
  StorageProvider,
  FileMetadata,
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from './storage-provider.interface';

// Provider implementations
export { LocalStorageProvider, LocalStorageConfig } from './local-storage.provider';
export { R2StorageProvider, R2StorageConfig } from './r2-storage.provider';

// Factory functions
export {
  createStorageProvider,
  getStorageProviderType,
  getDefaultStorageProvider,
  resetDefaultStorageProvider,
  StorageEnvironment,
  StorageFactoryConfig,
} from './storage-factory';
