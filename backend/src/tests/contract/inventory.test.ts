
import request from 'supertest';
import app from '../../index';
import express from 'express';
app.use(express.json());

describe('POST /inventory-items', () => {
  it('should respond with a 201 status code and the created item', async () => {
    const newItem = {
      product_id: 1,
      expiry_date: '2026-12-31',
      location_id: 1,
    };

    const response = await request(app)
      .post('/inventory-items')
      .send(newItem);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('status', 'Normal');
  });
});
