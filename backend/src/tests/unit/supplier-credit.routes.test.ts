import fs from 'node:fs';
import path from 'node:path';
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

  it('exposes only correction review operations on the platform router', () => {
    expect(routes(platformCatalogueCorrectionRouter)).toEqual([
      'GET /catalogue-corrections',
      'PATCH /catalogue-corrections/:id',
    ]);
  });

  it('mounts the platform router behind normal authentication', () => {
    const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.ts'), 'utf8');
    expect(indexSource).toContain(
      "app.use('/api/platform', authenticateToken, platformCatalogueCorrectionRouter)",
    );
  });
});
