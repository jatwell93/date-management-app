import request from 'supertest';
import app from '../../index';

describe('"Manager Report" Integration Scenario', () => {
  const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;

  afterEach(() => {
    process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
  });

  it('should allow a manager to generate a monthly markdown report', async () => {
    // Use test auth bypass instead of removed /auth/login endpoint
    process.env.TEST_AUTH_BYPASS = 'true';

    // Request the monthly markdown report (auth bypass injects manager user)
    const reportResponse = await request(app).get('/reports/monthly-markdown');

    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers['content-type']).toContain('application/json');
    expect(Array.isArray(reportResponse.body)).toBe(true);
  });
});
