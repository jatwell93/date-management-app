import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Logger } from '../utils/logger';
import { StoreAreaRepository } from '../repositories/store-area.repository';
import { ProductRepository } from '../repositories/product.repository';
import { InventoryRepository } from '../repositories/inventory.repository';

export interface SeedResult {
  success: boolean;
  productsCreated: number;
  areasCreated: number;
  inventoryItemsCreated: number;
}

export class SeedService {
  private prisma: PrismaClient;
  private storeAreaRepo: StoreAreaRepository;
  private productRepo: ProductRepository;
  private inventoryRepo: InventoryRepository;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.storeAreaRepo = new StoreAreaRepository(this.prisma);
    this.productRepo = new ProductRepository(this.prisma);
    this.inventoryRepo = new InventoryRepository(this.prisma);
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

        const areaResults = await Promise.all(
          areas.map(async (area) => {
            const existing = await this.storeAreaRepo.findByNameAndSubDepartmentWithTransaction(
              area.name,
              area.subDepartment,
              organizationId,
              tx,
            );
            if (existing) return { record: existing, created: false };
            const record = await this.storeAreaRepo.createWithTransaction(
              organizationId,
              area.name,
              area.subDepartment,
              tx,
            );
            return { record, created: true };
          }),
        );

        const createdAreas = areaResults.map((r) => r.record);
        const areasCreatedCount = areaResults.filter((r) => r.created).length;

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
          const existingProduct = await this.productRepo.findBySku(p.sku, organizationId, tx);

          let product;
          if (existingProduct) {
            product = existingProduct;
          } else {
            product = await this.productRepo.create(
              {
                organizationId,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode,
                costPrice: p.costPrice,
              },
              tx,
            );
            productsCreatedCount++;
          }

          // 3. Create Inventory Items with realistic expiry dates
          // Some soon-to-expire (2-3 months), some far (12-24 months)
          const monthsToAdd = p.areaIndex === 2 ? 6 : productsCreatedCount % 2 === 0 ? 3 : 18;
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);

          // Check if inventory item already exists for this product in this location
          const existingItem = await this.inventoryRepo.findFirst(
            {
              organizationId,
              productId: product.id,
              locationId: createdAreas[p.areaIndex].id,
            },
            tx,
          );

          if (!existingItem) {
            await this.inventoryRepo.create(
              {
                organizationId,
                productId: product.id,
                locationId: createdAreas[p.areaIndex].id,
                expiryDate,
                status: 'Normal',
              },
              tx,
            );
            inventoryItemsCreatedCount++;
          }
        }

        return {
          success: true,
          productsCreated: productsCreatedCount,
          areasCreated: areasCreatedCount,
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
