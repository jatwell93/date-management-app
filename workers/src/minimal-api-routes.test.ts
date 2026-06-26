import { describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import type { Database } from './database';
import type { Env } from './types/env';

const env = {} as Env;
const db = {} as Database;

describe('minimal API route table', () => {
  it('dispatches static API routes by method and pathname', async () => {
    const handleGetProducts = vi.fn().mockResolvedValue(new Response('products'));
    const routes: MinimalApiRoute[] = [['GET', '/api/products', handleGetProducts]];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/products'),
      pathname: '/api/products',
      method: 'GET',
      db,
      env,
    });

    expect(response?.status).toBe(200);
    expect(handleGetProducts).toHaveBeenCalledWith(expect.any(Request), db, env);
  });

  it('passes dynamic pathnames to matching handlers', async () => {
    const handleUpdateInventoryItem = vi.fn().mockResolvedValue(new Response('inventory'));
    const routes: MinimalApiRoute[] = [
      ['PUT', /^\/api\/inventory-items\/\d+$/, handleUpdateInventoryItem, 'path'],
    ];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/inventory-items/42', { method: 'PUT' }),
      pathname: '/api/inventory-items/42',
      method: 'PUT',
      db,
      env,
    });

    expect(response?.status).toBe(200);
    expect(handleUpdateInventoryItem).toHaveBeenCalledWith(
      expect.any(Request),
      db,
      env,
      '/api/inventory-items/42',
    );
  });

  it('returns null for unknown routes', async () => {
    const routes: MinimalApiRoute[] = [['GET', '/api/products', vi.fn()]];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/nope'),
      pathname: '/api/nope',
      method: 'GET',
      db,
      env,
    });

    expect(response).toBeNull();
  });
});
