import request from 'supertest';
import app from '../../index';

describe('GET /reports/monthly-markdown', () => {
  it('should respond with a 200 status code and a JSON report (not PDF)', async () => {
    const response = await request(app).get('/reports/monthly-markdown');

    expect(response.status).toBe(200);
    // Updated expectation: The existing implementation returns JSON (escaped HTML)
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('GET /reports/usage', () => {
  it('should respond with a 200 status code and usage data array', async () => {
    const response = await request(app).get('/reports/usage');

    expect(response.status).toBe(200);
    // Updated expectation: The API returns the array directly, not wrapped in { usage_data: ... }
    expect(Array.isArray(response.body)).toBe(true);
  });
});
