import request from 'supertest';
import app from '../../index';

describe('Clerk-only organization invites', () => {
  it('does not expose custom invite creation endpoint by default', async () => {
    const response = await request(app).post('/api/organizations/invites').send({
      email: 'invitee@example.com',
      role: 'team_member',
    });

    expect(response.status).toBe(404);
  });
});
