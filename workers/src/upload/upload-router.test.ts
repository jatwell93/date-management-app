import { describe, expect, it, vi } from 'vitest';
import { handleWorkerUploadRoute } from './upload-router';
import type { Env } from '../types/env';
import type { Database } from '../database';

const env = {
  NODE_ENV: 'development',
} as Env;

const db = {} as Database;

describe('Worker upload router', () => {
  it('dispatches /api/upload/complete to the completion handler', async () => {
    const handleUploadComplete = vi.fn().mockResolvedValue(new Response('complete'));

    const response = await handleWorkerUploadRoute({
      request: new Request('https://example.com/api/upload/complete', { method: 'POST' }),
      env,
      url: new URL('https://example.com/api/upload/complete'),
      pathname: '/api/upload/complete',
      method: 'POST',
      requestOrigin: 'https://app.example.com',
      getDb: () => db,
      handlers: {
        handleUploadComplete,
      },
    });

    expect(response?.status).toBe(200);
    expect(handleUploadComplete).toHaveBeenCalledWith(expect.any(Request), env, db);
  });

  it('returns a CORS-enabled 400 when an encoded upload key is malformed', async () => {
    const response = await handleWorkerUploadRoute({
      request: new Request('https://example.com/api/upload/status/%E0%A4%A', { method: 'GET' }),
      env,
      url: new URL('https://example.com/api/upload/status/%E0%A4%A'),
      pathname: '/api/upload/status/%E0%A4%A',
      method: 'GET',
      requestOrigin: 'https://app.example.com',
      getDb: () => db,
      handlers: {
        handleUploadStatus: vi.fn(),
      },
    });

    expect(response?.status).toBe(400);
    expect(response?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    await expect(response?.json()).resolves.toEqual({ error: 'Invalid key encoding' });
  });
});
