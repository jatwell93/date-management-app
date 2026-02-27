import request from 'supertest';
import app from '../../index';

describe('"Manager Dashboard" Integration Scenario', () => {
  const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;

  afterEach(() => {
    process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
  });

  it('should allow a manager to view the dashboard', async () => {
    // Use test auth bypass instead of removed /auth/login endpoint
    process.env.TEST_AUTH_BYPASS = 'true';

    // Request the dashboard data (auth bypass injects manager user)
    const dashboardResponse = await request(app).get('/dashboard');

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body).toHaveProperty('totalProducts');
    expect(dashboardResponse.body).toHaveProperty('expiringSoon');
    expect(dashboardResponse.body).toHaveProperty('markdownItems');
    expect(dashboardResponse.body).toHaveProperty('recentActivity');
  });
});
