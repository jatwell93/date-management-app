import express from 'express';
import request from 'supertest';

const mockGetDb = vi.fn();
const mockReleaseDb = vi.fn();
const mockGetDatabaseMetrics = vi.fn();
const mockValidateTierFeatureFlags = vi.fn();
const mockSubscriptionRepository = {};
const mockResolve = vi.fn();

vi.mock('../../database', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  releaseDb: (...args: unknown[]) => mockReleaseDb(...args),
}));

vi.mock('../../services/database.monitoring.service', () => ({
  DatabaseMonitoringService: {
    getInstance: vi.fn(() => ({
      getMetrics: (...args: unknown[]) => mockGetDatabaseMetrics(...args),
    })),
  },
}));

vi.mock('../../utils/validate-tier-flags', () => ({
  validateTierFeatureFlags: (...args: unknown[]) => mockValidateTierFeatureFlags(...args),
}));

vi.mock('../../di/container', () => ({
  getDiContainer: () => ({
    resolve: (...args: unknown[]) => mockResolve(...args),
  }),
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../middleware/requireOrgRole', () => ({
  requireOrgRole:
    (...allowedRoles: string[]) =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

import healthRouter, {
  initializeTierFlagValidation,
  revalidateTierFlags,
} from '../../routes/health.routes';

const validTierResult = {
  valid: true,
  missingFeatures: [],
  errors: [],
  warnings: [],
  flagCounts: {
    starter: 8,
    professional: 8,
    premium: 8,
    concierge: 8,
  },
};

const invalidTierResult = {
  valid: false,
  missingFeatures: ['starter.max_skus'],
  errors: ['Missing feature flag: starter.max_skus'],
  warnings: [],
  flagCounts: {
    starter: 7,
    professional: 8,
    premium: 8,
    concierge: 8,
  },
};

describe('health.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/', healthRouter);

  let db: {
    prepare: jest.Mock;
    pragma: jest.Mock;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    db = {
      prepare: vi.fn().mockImplementation(function (sql: string) {
        return {
          get: () => (sql.includes('ready') ? { ready: 1 } : { alive: 1 }),
        };
      }),
      pragma: vi.fn().mockReturnValue(1),
    };

    mockGetDb.mockReturnValue(db);
    mockResolve.mockReturnValue(mockSubscriptionRepository);
    mockGetDatabaseMetrics.mockReturnValue({ queryCount: 100, slowQueries: 2 });
    mockValidateTierFeatureFlags.mockResolvedValue(validTierResult);

    await initializeTierFlagValidation();
  });

  it('returns healthy status when tier flags are valid and database responds', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.services.database).toBe('healthy');
    expect(response.body.services.tierFeatureFlags).toBe('configured');
    expect(response.body.tierFlags.flagCounts.starter).toBe(8);
    expect(mockValidateTierFeatureFlags).toHaveBeenCalledWith(mockSubscriptionRepository);
    expect(mockReleaseDb).toHaveBeenCalledWith(db);
  });

  it('returns unhealthy health check when tier flags are invalid', async () => {
    mockValidateTierFeatureFlags.mockResolvedValue(invalidTierResult);
    const isValid = await revalidateTierFlags();

    expect(isValid).toBe(false);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.error).toContain('Tier feature flags not properly configured');
  });

  it('returns unhealthy health check when database connectivity check fails', async () => {
    db.prepare.mockReturnValue({ get: () => ({ alive: 0 }) });

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.error).toBe('Database connectivity test failed');
  });

  it('returns unhealthy health check when database connectivity throws', async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error('db crashed');
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.error).toBe('Database connectivity error');
  });

  it('returns alive status for liveness probe', async () => {
    const response = await request(app).get('/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('alive');
  });

  it('returns ready status when tier flags are valid and database is ready', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
  });

  it('returns not ready when tier flags are invalid', async () => {
    mockValidateTierFeatureFlags.mockResolvedValue(invalidTierResult);
    await revalidateTierFlags();

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not ready');
    expect(response.body.error).toContain('Tier feature flags');
  });

  it('returns not ready when database throws', async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error('db unavailable');
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not ready');
    expect(response.body.error).toBe('Database not available');
  });

  it('returns not ready when database readiness probe returns non-ready value', async () => {
    db.prepare.mockImplementation(function (sql: string) {
      return {
        get: () => (sql.includes('ready') ? { ready: 0 } : { alive: 1 }),
      };
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not ready');
    expect(response.body.error).toBeUndefined();
  });

  it('returns process and memory metrics from /metrics', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body).toHaveProperty('memory.heapUsed');
    expect(response.body).toHaveProperty('process.pid');
  });

  it('returns database metrics payload when monitoring service succeeds', async () => {
    const response = await request(app).get('/database-metrics');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.metrics).toEqual({ queryCount: 100, slowQueries: 2 });
  });

  it('returns 500 when database metrics retrieval throws', async () => {
    mockGetDatabaseMetrics.mockImplementation(() => {
      throw new Error('metrics unavailable');
    });

    const response = await request(app).get('/database-metrics');

    expect(response.status).toBe(500);
    expect(response.body.status).toBe('error');
    expect(response.body.error).toContain('metrics unavailable');
  });

  it('returns healthy database-health payload when db checks pass', async () => {
    const response = await request(app).get('/database-health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.database.connected).toBe(true);
    expect(mockReleaseDb).toHaveBeenCalledWith(db);
  });

  it('returns unhealthy database-health payload when getDb throws', async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error('db not reachable');
    });

    const response = await request(app).get('/database-health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.database.connected).toBe(false);
    expect(response.body.database.error).toContain('db not reachable');
  });

  it('returns unhealthy database-health payload when alive check is not 1', async () => {
    db.prepare.mockReturnValue({ get: () => ({ alive: 0 }) });

    const response = await request(app).get('/database-health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.database.connected).toBe(false);
    expect(response.body.database.error).toBe('Database connectivity test failed');
  });

  it('returns empty alerts list for /recent-alerts', async () => {
    const response = await request(app).get('/recent-alerts');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.alerts).toEqual([]);
  });

  it('returns revalidation boolean for tier flag refresh calls', async () => {
    mockValidateTierFeatureFlags.mockResolvedValue(validTierResult);

    const result = await revalidateTierFlags();

    expect(result).toBe(true);
  });
});
