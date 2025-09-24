
import request from 'supertest';
import app from '../../index';

describe('GET /dashboard', () => {
  it('should respond with a 200 status code and dashboard data', async () => {
    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('markdown_next_month_value');
    expect(response.body).toHaveProperty('top_5_markdown_items');
    expect(response.body).toHaveProperty('areas_not_checked_30_days');
  });
});
