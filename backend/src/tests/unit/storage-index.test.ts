/**
 * Unit Tests for Storage Module Exports
 */

import * as storage from '../../storage';

describe('Storage module exports', () => {
  it('exports provider classes and factory helpers', () => {
    expect(storage.LocalStorageProvider).toBeDefined();
    expect(storage.R2StorageProvider).toBeDefined();
    expect(storage.createStorageProvider).toBeDefined();
    expect(storage.getStorageProviderType).toBeDefined();
    expect(storage.getDefaultStorageProvider).toBeDefined();
    expect(storage.resetDefaultStorageProvider).toBeDefined();
  });

  it('exports error types', () => {
    expect(storage.FileNotFoundError).toBeDefined();
    expect(storage.FileSizeLimitError).toBeDefined();
    expect(storage.StorageProviderError).toBeDefined();
  });
});
