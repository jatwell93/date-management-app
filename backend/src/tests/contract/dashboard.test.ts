import request from 'supertest';
import app from '../../index';

describe('GET /dashboard', () => {
  it('should respond with a 200 status code and dashboard data', async () => {
    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('expiringSoon');
    expect(response.body).toHaveProperty('markdownItems');
    expect(response.body).toHaveProperty('recentActivity');
  });
});
