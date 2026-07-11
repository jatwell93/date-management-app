/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import { CreditClaimController } from '../../controllers/credit-claim.controller';
import type { CreditClaimService } from '../../services/credit-claim.service';

function buildApp(service: Partial<CreditClaimService>) {
  const controller = new CreditClaimController(() => service as CreditClaimService);
  const app = express();
  app.use(express.json());
  // Stand-in auth: populate the org + user the controllers read.
  app.use((req: any, _res, next) => {
    req.organizationId = 'org-123';
    req.userId = 7;
    next();
  });
  const upload = multer({ storage: multer.memoryStorage() });

  app.get('/claims', (req, res, next) => controller.listClaims(req as any, res, next));
  app.get('/recovery-report', (req, res, next) =>
    controller.getRecoveryReport(req as any, res, next),
  );
  app.post('/claims', (req, res, next) => controller.buildClaim(req as any, res, next));
  app.post('/claims/:id/lines/:lineId/photos', upload.single('file'), (req, res, next) =>
    controller.addPhoto(req as any, res, next),
  );

  // Minimal error handler mapping our BaseError statusCode.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('CreditClaimController routes', () => {
  it('maps ?view=open to the open statuses', async () => {
    const listClaims = vi.fn(async () => []);
    const app = buildApp({ listClaims } as any);

    await request(app).get('/claims?view=open').expect(200);
    expect(listClaims).toHaveBeenCalledWith(['DRAFT', 'SENDING', 'SENT', 'ACKNOWLEDGED']);
  });

  it('maps ?view=settled to the settled statuses', async () => {
    const listClaims = vi.fn(async () => []);
    const app = buildApp({ listClaims } as any);

    await request(app).get('/claims?view=settled').expect(200);
    expect(listClaims).toHaveBeenCalledWith([
      'CREDITED',
      'PARTIALLY_CREDITED',
      'REJECTED',
      'CANCELLED',
    ]);
  });

  it('lists all claims when no view is given', async () => {
    const listClaims = vi.fn(async () => []);
    const app = buildApp({ listClaims } as any);

    await request(app).get('/claims').expect(200);
    expect(listClaims).toHaveBeenCalledWith(undefined);
  });

  it('passes the authenticated userId into buildClaim', async () => {
    const buildClaim = vi.fn(async () => ({ id: 1 }));
    const app = buildApp({ buildClaim } as any);

    await request(app)
      .post('/claims')
      .send({ supplierId: 10, lines: [{ expiredItemTransactionId: 1 }] })
      .expect(201);
    expect(buildClaim).toHaveBeenCalledWith(
      { supplierId: 10, lines: [{ expiredItemTransactionId: 1 }] },
      7,
    );
  });

  it('rejects a photo upload with no file (400)', async () => {
    const addPhoto = vi.fn();
    const app = buildApp({ addPhoto } as any);

    await request(app).post('/claims/1/lines/2/photos').expect(400);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it('returns the recovery report', async () => {
    const getRecoveryReport = vi.fn(async () => ({
      outstandingValue: 150,
      unclaimedValue: 200,
      suppliers: [],
    }));
    const app = buildApp({ getRecoveryReport } as any);

    const res = await request(app).get('/recovery-report').expect(200);
    expect(res.body).toEqual({ outstandingValue: 150, unclaimedValue: 200, suppliers: [] });
  });
});
