import request from 'supertest';
import app from '../../index';
import express from 'express';
import fs from 'fs';
import path from 'path';
app.use(express.json());

describe('GET /products', () => {
  it('should respond with a 200 status code and product data for a valid barcode', async () => {
    const barcode = '123456789';
    const response = await request(app).get(`/products?barcode=${barcode}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('barcode', barcode);
  });
});

describe('POST /products/upload-csv', () => {
  it('should respond with a 200 status code and a success message for a valid CSV file', async () => {
    const csvFilePath = path.resolve(__dirname, 'test-products.csv');
    const csvContent = 'barcode,sku,name,cost_price\n123,SKU123,Test Product,10.00';
    fs.writeFileSync(csvFilePath, csvContent);

    const response = await request(app).post('/products/upload-csv').attach('file', csvFilePath);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Product data updated successfully.');

    fs.unlinkSync(csvFilePath); // Clean up the test file
  });
});

describe('POST /products', () => {
  it('should respond with a 201 status code and the created product', async () => {
    const newProduct = {
      barcode: '987654321',
      sku: 'SKU987',
      name: 'New Product Name',
      cost_price: 15.0,
    };

    const response = await request(app).post('/products').send(newProduct);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('name', newProduct.name);
  });
});
