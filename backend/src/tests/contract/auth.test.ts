import request from 'supertest';
import app from '../../index';

describe('POST /auth/login', () => {
  beforeAll(() => {
    process.env.TEST_AUTH_BYPASS = 'false';
  });

  it('should respond with a 200 status code and a token for valid credentials', async () => {
    // This test will fail with a connection refused error until the server is running
    // and the endpoint is implemented. This is the correct TDD workflow.
    const response = await request(app).post('/auth/login').send({ pin: '5624' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
  });
});

describe('POST /auth/refresh', () => {
  beforeAll(() => {
    process.env.TEST_AUTH_BYPASS = 'false';
  });

  it('should respond with a 200 status code and a new token for authenticated users', async () => {
    const loginResponse = await request(app).post('/auth/login').send({ pin: '5624' });

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token as string;

    const response = await request(app)
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  it('should respond with a 401 status code when no token is provided', async () => {
    const response = await request(app).post('/auth/refresh').send();

    expect(response.status).toBe(401);
  });
});
