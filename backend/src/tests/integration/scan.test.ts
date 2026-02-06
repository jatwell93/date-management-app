import request from 'supertest';
import app from '../../index';
import express from 'express';
import { getDefaultDatabaseClient, disconnectDatabase } from '../../database/database-factory';

const prisma = getDefaultDatabaseClient();
app.use(express.json());

describe('"Scan & Save" Integration Scenario', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should allow scanning a product and saving it as an inventory item', async () => {
    // Seed a product first
    const now = Date.now();
    const uniqueSuffix = Math.random().toString(36).slice(2, 10);
    const barcode = `SCAN-${now}-${uniqueSuffix}`;
    const product = await prisma.product.create({
      data: {
        barcode,
        name: 'Test Product',
        sku: `TEST-SKU-${now}-${uniqueSuffix}`,
        costPrice: 10.99,
      },
    });

    const storeArea = await prisma.storeArea.create({
      data: {
        name: `Scan Area ${now}-${uniqueSuffix}`,
        subDepartment: 'Test',
      },
    });

    const loginResponse = await request(app).post('/auth/login').send({ pin: '5624' });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token;
    expect(token).toBeDefined();

    // Step 1: Scan a product (simulate by getting product by barcode)
    const getProductResponse = await request(app)
      .get(`/products/by-barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getProductResponse.status).toBe(200);
    const fetchedProduct = getProductResponse.body;
    expect(fetchedProduct).toHaveProperty('id');

    // Step 2: Save the scanned product as an inventory item
    const newItem = {
      productId: product.id,
      locationId: storeArea.id,
      expiryDate: '2026-12-31',
      status: 'Normal',
    };

    const postInventoryResponse = await request(app)
      .post('/inventory-items')
      .set('Authorization', `Bearer ${token}`)
      .send(newItem);

    expect(postInventoryResponse.status).toBe(201);
    expect(postInventoryResponse.body).toHaveProperty('id');
    expect(postInventoryResponse.body).toHaveProperty('productId', product.id);
  });
});
