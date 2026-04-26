/**
 * Integration Tests for Storage Providers
 *
 * Validates LocalStorageProvider against filesystem and R2StorageProvider
 * against a real R2 bucket when credentials are available.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LocalStorageProvider } from '../../storage/local-storage.provider';
import { R2StorageProvider } from '../../storage/r2-storage.provider';

const localBasePath = path.join(__dirname, '../../../test-uploads-integration');

describe('StorageProvider Integration', () => {
  describe('LocalStorageProvider', () => {
    let provider: LocalStorageProvider;

    beforeAll(async () => {
      await fs.mkdir(localBasePath, { recursive: true });
    });

    beforeEach(() => {
      provider = new LocalStorageProvider({
        basePath: localBasePath,
        maxFileSizeBytes: 1024 * 1024,
      });
    });

    afterEach(async () => {
      try {
        const entries = await fs.readdir(localBasePath);
        await Promise.all(
          entries.map(async (entry) => {
            const entryPath = path.join(localBasePath, entry);
            const stat = await fs.stat(entryPath);
            if (stat.isDirectory()) {
              await fs.rm(entryPath, { recursive: true });
            } else {
              await fs.unlink(entryPath);
            }
          }),
        );
      } catch {
        // Ignore cleanup errors
      }
    });

    afterAll(async () => {
      try {
        await fs.rm(localBasePath, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('uploads, downloads, and deletes files', async () => {
      const key = `integration/${Date.now()}-local.txt`;
      const data = Buffer.from('Local integration test');

      await provider.upload(key, data, 'text/plain');
      expect(await provider.exists(key)).toBe(true);

      const downloaded = await provider.download(key);
      expect(downloaded.toString()).toBe('Local integration test');

      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });
  });

  const r2IntegrationEnabled = process.env.RUN_R2_INTEGRATION_TESTS === 'true';
  const hasR2Config = Boolean(
    r2IntegrationEnabled &&
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );

  (hasR2Config ? describe : describe.skip)('R2StorageProvider', () => {
    let provider: R2StorageProvider;
    const createdKeys: string[] = [];

    beforeAll(() => {
      provider = new R2StorageProvider({
        accountId: process.env.R2_ACCOUNT_ID as string,
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
        bucketName: process.env.R2_BUCKET_NAME as string,
        maxFileSizeBytes: 1024 * 1024,
      });
    });

    afterAll(async () => {
      await Promise.all(
        createdKeys.map(async (key) => {
          try {
            await provider.delete(key);
          } catch {
            // Ignore cleanup errors
          }
        }),
      );
    });

    it('uploads, downloads, and deletes files', async () => {
      const key = `integration/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
      const data = Buffer.from('R2 integration test');

      createdKeys.push(key);

      await provider.upload(key, data, 'text/plain');
      expect(await provider.exists(key)).toBe(true);

      const downloaded = await provider.download(key);
      expect(downloaded.toString()).toBe('R2 integration test');

      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });
  });
});
