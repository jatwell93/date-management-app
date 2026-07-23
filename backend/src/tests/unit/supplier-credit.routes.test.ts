import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Response } from 'express';
import request from 'supertest';

const controllerMocks = vi.hoisted(() => {
  const respond = async (_req: unknown, res: Response) => {
    res.status(204).end();
  };
  return {
    updateSupplier: vi.fn(respond),
    patchSupplier: vi.fn(respond),
    clearSupplierPolicy: vi.fn(respond),
  };
});

vi.mock('../../controllers/supplier-credit.controller', () => ({
  createSupplierCreditController: () => controllerMocks,
}));

import supplierCreditRouter, {
  platformCatalogueCorrectionRouter,
} from '../../routes/supplier-credit.routes';

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routes(router: unknown): string[] {
  const stack = (router as { stack: RouterLayer[] }).stack;
  return stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const route = layer.route!;
      const method = Object.keys(route.methods).find((key) => route.methods[key]);
      return `${method?.toUpperCase()} ${route.path}`;
    });
}

describe('supplier credit route wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes brand review, confirmation, override, and disposal endpoints', () => {
    expect(routes(supplierCreditRouter)).toEqual(
      expect.arrayContaining([
        'GET /brands',
        'GET /brand-review',
        'POST /brands',
        'PUT /brands/:id/supplier',
        'PUT /products/:productId/supplier',
        'POST /claimable-pool/:transactionId/dispose',
        'PATCH /suppliers/:id',
        'DELETE /suppliers/:id/policy',
        'GET /policy-review',
        'POST /policy-review/bulk-attach',
        'POST /brands/bulk-link',
      ]),
    );
  });

  it('exposes correction review and provenance operations on the platform router', () => {
    expect(routes(platformCatalogueCorrectionRouter)).toEqual([
      'GET /catalogue-corrections',
      'GET /catalogue/provenance',
      'PATCH /catalogue-corrections/:id',
    ]);
  });

  it('mounts the platform router behind normal authentication', () => {
    const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.ts'), 'utf8');
    expect(indexSource).toContain(
      "app.use('/api/platform', authenticateToken, platformCatalogueCorrectionRouter)",
    );
  });

  it.each([
    ['PUT', '/suppliers/not-a-number', { name: 'Supplier' }, controllerMocks.updateSupplier],
    ['PATCH', '/suppliers/not-a-number', { name: 'Supplier' }, controllerMocks.patchSupplier],
    ['DELETE', '/suppliers/not-a-number/policy', undefined, controllerMocks.clearSupplierPolicy],
  ])(
    'rejects an invalid supplier ID on %s before controller access',
    async (method, url, body, fn) => {
      const app = express();
      app.use(express.json());
      app.use(supplierCreditRouter);
      app.use(((error, _req, res, _next) => {
        const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
        res.status(statusCode).json({ message: (error as Error).message });
      }) as ErrorRequestHandler);

      const response =
        method === 'PUT'
          ? await request(app).put(url).send(body)
          : method === 'PATCH'
            ? await request(app).patch(url).send(body)
            : await request(app).delete(url);

      expect(response.status).toBe(400);
      expect(fn).not.toHaveBeenCalled();
    },
  );
});
