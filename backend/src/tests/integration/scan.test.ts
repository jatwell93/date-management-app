
import request from 'supertest';
import app from '../../index';
import express from 'express';
app.use(express.json());

describe('"Scan & Save" Integration Scenario', () => {
  it('should allow scanning a product and saving it as an inventory item', async () => {
    // Step 1: Scan a product (simulate by getting product by barcode)
    const barcode = '123456789012'; // A known barcode
    const getProductResponse = await request(app).get(`/products?barcode=${barcode}`);
    
    expect(getProductResponse.status).toBe(200);
    const product = getProductResponse.body;
    expect(product).toHaveProperty('id');

    // Step 2: Save the scanned product as an inventory item
    const newItem = {
      product_id: product.id,
      location: 'Aisle 3, Shelf 2',
      best_before_date: '2024-12-31',
      status: 'Normal',
    };

    const postInventoryResponse = await request(app)
      .post('/inventory-items')
      .send(newItem);

    expect(postInventoryResponse.status).toBe(201);
    expect(postInventoryResponse.body).toHaveProperty('id');
    expect(postInventoryResponse.body).toHaveProperty('product_id', product.id);
  });
});
