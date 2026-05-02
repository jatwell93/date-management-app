import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Logger } from '../utils/logger';

export interface SeedResult {
  success: boolean;
  productsCreated: number;
  areasCreated: number;
  inventoryItemsCreated: number;
}

export class SeedService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  async seedDemoData(organizationId: string): Promise<SeedResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Create Sample Store Areas
        const areas = [
          { name: 'Front Shelf', subDepartment: 'Over-the-Counter' },
          { name: 'Back Storage', subDepartment: 'Prescription' },
          { name: 'Cooler', subDepartment: 'Refrigerated' },
        ];

        const createdAreas = await Promise.all(
          areas.map((area) =>
            tx.storeArea.upsert({
              where: {
                organizationId_name_subDepartment: {
                  organizationId,
                  name: area.name,
                  subDepartment: area.subDepartment,
                },
              },
              update: {},
              create: {
                organizationId,
                name: area.name,
                subDepartment: area.subDepartment,
              },
            }),
          ),
        );

        // 2. Create Sample Pharmacy Products
        const products = [
          {
            name: 'Vitamin C 500mg',
            sku: 'VIT-C-500',
            barcode: '123456789012',
            costPrice: 5.5,
            areaIndex: 0,
          },
          {
            name: 'Ibuprofen 200mg',
            sku: 'IBU-200',
            barcode: '123456789013',
            costPrice: 4.2,
            areaIndex: 0,
          },
          {
            name: 'Paracetamol 500mg',
            sku: 'PARA-500',
            barcode: '123456789014',
            costPrice: 3.8,
            areaIndex: 0,
          },
          {
            name: 'Amoxicillin 250mg',
            sku: 'AMOX-250',
            barcode: '123456789015',
            costPrice: 12.0,
            areaIndex: 1,
          },
          {
            name: 'Lisinopril 10mg',
            sku: 'LISI-10',
            barcode: '123456789016',
            costPrice: 8.5,
            areaIndex: 1,
          },
          {
            name: 'Metformin 500mg',
            sku: 'MET-500',
            barcode: '123456789017',
            costPrice: 6.0,
            areaIndex: 1,
          },
          {
            name: 'Insulin Glargine',
            sku: 'INSU-GLA',
            barcode: '123456789018',
            costPrice: 45.0,
            areaIndex: 2,
          },
          {
            name: 'EpiPen 0.3mg',
            sku: 'EPI-300',
            barcode: '123456789019',
            costPrice: 150.0,
            areaIndex: 2,
          },
        ];

        let productsCreatedCount = 0;
        let inventoryItemsCreatedCount = 0;

        for (const p of products) {
          const product = await tx.product.upsert({
            where: {
              organizationId_sku: {
                organizationId,
                sku: p.sku,
              },
            },
            update: {},
            create: {
              organizationId,
              name: p.name,
              sku: p.sku,
              barcode: p.barcode,
              costPrice: p.costPrice,
            },
          });

          productsCreatedCount++;

          // 3. Create Inventory Items with realistic expiry dates
          // Some soon-to-expire (2-3 months), some far (12-24 months)
          const monthsToAdd = p.areaIndex === 2 ? 6 : productsCreatedCount % 2 === 0 ? 3 : 18;
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);

          // Check if inventory item already exists for this product in this location
          const existingItem = await tx.inventoryItem.findFirst({
            where: {
              organizationId,
              productId: product.id,
              locationId: createdAreas[p.areaIndex].id,
            },
          });

          if (!existingItem) {
            await tx.inventoryItem.create({
              data: {
                organizationId,
                productId: product.id,
                locationId: createdAreas[p.areaIndex].id,
                expiryDate,
                status: 'Normal',
              },
            });
            inventoryItemsCreatedCount++;
          }
        }

        return {
          success: true,
          productsCreated: productsCreatedCount,
          areasCreated: createdAreas.length,
          inventoryItemsCreated: inventoryItemsCreatedCount,
        };
      });
    } catch (error) {
      Logger.error(`Failed to seed demo data for organization ${organizationId}:`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
