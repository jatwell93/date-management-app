# Storage Patterns

This document describes the storage abstraction layer used for file operations across development and production environments.

## Overview

The storage abstraction provides a unified interface for file storage operations, allowing the application to seamlessly switch between:

- **Development**: Local filesystem storage
- **Production**: Cloudflare R2 cloud storage

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Application Code                          │
│                  (Services, Controllers)                     │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│               StorageProvider Interface                      │
│     upload() | download() | delete() | exists()              │
└─────────────────────────┬────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐
│ LocalStorageProvider │       │  R2StorageProvider   │
│    (Development)     │       │    (Production)      │
│                      │       │                      │
│  - Filesystem        │       │  - AWS S3 SDK        │
│  - Sidecar metadata  │       │  - Presigned URLs    │
└──────────────────────┘       └──────────────────────┘
          │                               │
          ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐
│   ./uploads/         │       │   Cloudflare R2      │
│   Local Directory    │       │   Cloud Bucket       │
└──────────────────────┘       └──────────────────────┘
```

## StorageProvider Interface

All storage providers implement this interface:

```typescript
interface StorageProvider {
  // Upload a file
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  
  // Download a file
  download(key: string): Promise<Buffer>;
  
  // Delete a file
  delete(key: string): Promise<void>;
  
  // Check if file exists
  exists(key: string): Promise<boolean>;
  
  // Generate presigned URL (R2 only)
  getPresignedUploadUrl?(key: string, expiresIn: number): Promise<string>;
  
  // Get file metadata
  getMetadata?(key: string): Promise<FileMetadata>;
}
```

## Usage

### Basic Usage

```typescript
import { getDefaultStorageProvider } from './storage';

const storage = getDefaultStorageProvider();

// Upload a file
const key = await storage.upload('uploads/data.csv', csvBuffer, 'text/csv');

// Download a file
const data = await storage.download('uploads/data.csv');

// Check if file exists
const exists = await storage.exists('uploads/data.csv');

// Delete a file
await storage.delete('uploads/data.csv');
```

### With Dependency Injection

```typescript
import { createStorageProvider, StorageProvider } from './storage';

class CsvUploadService {
  constructor(private storage: StorageProvider) {}

  async uploadCsv(filename: string, content: Buffer): Promise<string> {
    const key = `csv-uploads/${Date.now()}-${filename}`;
    return this.storage.upload(key, content, 'text/csv');
  }
}

// In production
const service = new CsvUploadService(createStorageProvider());

// In tests
const mockStorage = { upload: jest.fn() };
const service = new CsvUploadService(mockStorage);
```

### Explicit Environment

```typescript
import { createStorageProvider } from './storage';

// Force local storage even in production
const localStorage = createStorageProvider({
  environment: 'development',
  localBasePath: '/custom/path',
});

// Force R2 even in development
const r2Storage = createStorageProvider({
  environment: 'production',
  r2AccountId: 'your-account',
  r2AccessKeyId: 'your-key',
  r2SecretAccessKey: 'your-secret',
  r2BucketName: 'your-bucket',
});
```

## Error Handling

The storage layer provides typed errors for common scenarios:

```typescript
import { 
  FileNotFoundError, 
  FileSizeLimitError, 
  StorageProviderError 
} from './storage';

try {
  const data = await storage.download('missing-file.csv');
} catch (error) {
  if (error instanceof FileNotFoundError) {
    // Handle missing file - return 404
    return res.status(404).json({ error: 'File not found' });
  }
  if (error instanceof FileSizeLimitError) {
    // Handle file too large - return 413
    return res.status(413).json({ error: 'File too large' });
  }
  if (error instanceof StorageProviderError) {
    // Handle general storage errors - return 500
    console.error('Storage error:', error.originalError);
    return res.status(500).json({ error: 'Storage error' });
  }
  throw error; // Rethrow unknown errors
}
```

## Environment Configuration

### Development (Default)

No configuration required. Files are stored in `./uploads/`.

```bash
NODE_ENV=development
# or simply omit NODE_ENV
```

### Production

Requires Cloudflare R2 credentials:

```bash
NODE_ENV=production
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=csv-uploads-prod
```

### Test

Uses local storage in `./test-uploads/` directory:

```bash
NODE_ENV=test
```

## Presigned URLs (R2 Only)

For large file uploads (>2MB), use presigned URLs for direct browser-to-R2 uploads:

```typescript
import { R2StorageProvider } from './storage';

// Only R2 supports presigned URLs
if (storage instanceof R2StorageProvider) {
  const presignedUrl = await storage.getPresignedUploadUrl(
    'uploads/large-file.csv',
    3600 // expires in 1 hour
  );
  
  // Return URL to client for direct upload
  return res.json({ uploadUrl: presignedUrl });
}
```

## File Key Conventions

Use consistent key patterns for organization:

```
csv-uploads/           # CSV file uploads
  {timestamp}-{filename}.csv

images/                # Image uploads
  products/{id}.jpg

temp/                  # Temporary files (auto-cleaned)
  processing/{uuid}.tmp
```

## Security Considerations

1. **Directory Traversal Protection**: Keys are sanitized to prevent `../` attacks
2. **File Size Limits**: Configurable max file size (default 10MB)
3. **Content Type Validation**: Caller must specify content type
4. **Presigned URL Expiry**: Short expiration times (1 hour default)

## Testing

### Mocking the Storage Provider

```typescript
import { StorageProvider } from './storage';

const mockStorage: StorageProvider = {
  upload: jest.fn().mockResolvedValue('test-key'),
  download: jest.fn().mockResolvedValue(Buffer.from('test')),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(true),
};

// Inject into service
const service = new MyService(mockStorage);
```

### Integration Testing

The local storage provider is suitable for integration tests:

```typescript
import { createStorageProvider, resetDefaultStorageProvider } from './storage';

beforeEach(() => {
  resetDefaultStorageProvider();
  process.env.NODE_ENV = 'test';
});

it('should upload and download file', async () => {
  const storage = createStorageProvider();
  const key = await storage.upload('test.txt', Buffer.from('hello'), 'text/plain');
  const data = await storage.download(key);
  expect(data.toString()).toBe('hello');
});
```

## Performance Considerations

1. **Streaming**: For large files (>50MB), consider streaming instead of loading into memory
2. **Concurrency**: Both providers are thread-safe
3. **Caching**: Consider adding a caching layer for frequently accessed files
4. **Connection Pooling**: R2 provider reuses HTTP connections via SDK

## Migration Path

To migrate from local storage to R2:

1. Set up R2 bucket and credentials
2. Update environment variables
3. Deploy with `NODE_ENV=production`
4. Use migration script to sync existing files if needed

```bash
# Sync local files to R2 (if needed)
npm run storage:sync -- --source ./uploads --target r2://csv-uploads-prod
```
