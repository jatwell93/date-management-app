import request from 'supertest';
import app from '../../index';

describe('GET /reports/monthly-markdown', () => {
  it('should respond with a 200 status code and a PDF file', async () => {
    const response = await request(app).get('/reports/monthly-markdown');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toEqual('application/pdf');
  });
});

describe('GET /reports/usage', () => {
  it('should respond with a 200 status code and usage data', async () => {
    const response = await request(app).get('/reports/usage');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('usage_data');
    expect(Array.isArray(response.body.usage_data)).toBe(true);
  });
});