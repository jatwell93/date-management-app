/**
 * Unit tests for storage provider error types
 */

import {
  FileNotFoundError,
  FileSizeLimitError,
  StorageProviderError,
} from '../../storage/storage-provider.interface';

describe('Storage Provider Errors', () => {
  it('sets FileNotFoundError name and message', () => {
    const error = new FileNotFoundError('missing-file');

    expect(error.name).toBe('FileNotFoundError');
    expect(error.message).toBe('File not found: missing-file');
  });

  it('sets FileSizeLimitError name and message', () => {
    const error = new FileSizeLimitError(12, 10);

    expect(error.name).toBe('FileSizeLimitError');
    expect(error.message).toBe('File size 12 bytes exceeds limit of 10 bytes');
  });

  it('sets StorageProviderError name and preserves original error', () => {
    const original = new Error('original');
    const error = new StorageProviderError('storage failed', original);

    expect(error.name).toBe('StorageProviderError');
    expect(error.message).toBe('storage failed');
    expect(error.originalError).toBe(original);
  });
});
