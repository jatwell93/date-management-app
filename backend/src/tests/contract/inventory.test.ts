// Mock auth middleware to bypass check
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { id: 1, role: 'Manager', organizationId: 'default-org', tierLevel: 'professional' };
    req.userId = 1;
    req.userRole = 'Manager';
    req.organizationId = 'default-org';
    req.tierLevel = 'professional';
    next();
  },
  requireManager: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import { getDefaultDatabaseClient, disconnectDatabase } from '../../database/database-factory';
import app from '../../index';
import express from 'express';

app.use(express.json());

const prisma = getDefaultDatabaseClient();
let productId: number;
let locationId: number;

beforeEach(async () => {
  const now = Date.now();
  const uniqueSuffix = Math.random().toString(36).slice(2, 10);

  // Ensure default-org and test user exist
  await prisma.organization.upsert({
    where: { id: 'default-org' },
    update: {},
    create: { id: 'default-org', name: 'Default Test Org', slug: `default-org-${uniqueSuffix}`, contactEmail: 'test@default.org' },
  });
  await prisma.user.upsert({
    where: { id: 1 },
    update: { organizationId: 'default-org' },
    create: { id: 1, role: 'Manager', organizationId: 'default-org' },
  });

  const product = await prisma.product.create({
    data: {
      barcode: `CONTRACT-BARCODE-${now}-${uniqueSuffix}`,
      sku: `CONTRACT-SKU-${now}-${uniqueSuffix}`,
      name: 'Contract Test Product',
      costPrice: 5,
      notes: '',
      organizationId: 'default-org',
    },
  });

  const storeArea = await prisma.storeArea.create({
    data: {
      name: `Contract Area ${now}-${uniqueSuffix}`,
      subDepartment: 'Test',
      organizationId: 'default-org',
    },
  });

  productId = product.id;
  locationId = storeArea.id;
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('POST /inventory-items', () => {
  it('should respond with a 201 status code and the created item', async () => {
    const newItem = {
      productId,
      expiryDate: '2026-12-31',
      locationId,
    };

    const response = await request(app).post('/inventory-items').send(newItem);

    if (response.status !== 201) {
      console.log('Inventory POST failed:', response.status, response.body);
    }

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('status', 'Normal');
  });
});
