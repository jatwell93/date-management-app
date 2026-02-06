import request from 'supertest';
import app from '../../index';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
app.use(express.json());

describe('GET /products', () => {
  it('should respond with a 200 status code and product data for a valid barcode', async () => {
    // Using a known barcode from the seeded/mock data
    const barcode = '1234567890123';
    await prisma.product.create({
      data: {
        barcode,
        name: 'Contract Test Product',
        sku: 'CONTRACT-SKU-1',
        costPrice: 5.00
      }
    });

    // Use the specific by-barcode endpoint as per route definition
    const response = await request(app).get(`/products/by-barcode/${barcode}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('barcode', barcode);
  });
});

describe('POST /products/upload-csv', () => {
  it('should respond with a 200 status code and a success message for a valid CSV file', async () => {
    const csvFilePath = path.resolve(__dirname, 'test-products.csv');
    // Changed header from 'cost_price' (snake_case) to 'Cost' (allowed alternative in product.service.ts)
    // Also matched keys in the CSV content to the header logic
    const csvContent = 'Barcode,SKU,Name,Cost\n123,SKU123,Test Product,10.00';
    fs.writeFileSync(csvFilePath, csvContent);

    const response = await request(app).post('/products/upload-csv').attach('file', csvFilePath);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'CSV processed successfully');

    fs.unlinkSync(csvFilePath); // Clean up the test file
  });
});

describe('POST /products', () => {
  it('should respond with a 201 status code and the created product', async () => {
    const uniqueId = Date.now().toString();
    const newProduct = {
      barcode: `987${uniqueId.substring(6)}`, // Ensure unique/valid length
      sku: `SKU987${uniqueId}`,
      name: 'New Product Name',
      costPrice: 15.0,
    };

    const response = await request(app).post('/products').send(newProduct);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('name', newProduct.name);
  });
});
