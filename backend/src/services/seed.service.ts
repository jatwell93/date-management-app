import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
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

export interface MasterCatalogueSeedEntry {
  barcode: string;
  description: string;
  apiSku: string | null;
  sigmaSku: string | null;
  ch2Sku: string | null;
  brandName: string;
  manufacturerName: string | null;
  category: string | null;
  subCategory: string | null;
  rrp: number | null;
  metroPrice: number | null;
}

export interface MasterCatalogueParseResult {
  entries: MasterCatalogueSeedEntry[];
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface MasterCatalogueSeedResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

function masterCatalogueEntryMatches(
  existing: MasterCatalogueSeedEntry,
  expected: MasterCatalogueSeedEntry,
): boolean {
  return (
    existing.barcode === expected.barcode &&
    existing.description === expected.description &&
    existing.apiSku === expected.apiSku &&
    existing.sigmaSku === expected.sigmaSku &&
    existing.ch2Sku === expected.ch2Sku &&
    existing.brandName === expected.brandName &&
    existing.manufacturerName === expected.manufacturerName &&
    existing.category === expected.category &&
    existing.subCategory === expected.subCategory &&
    existing.rrp === expected.rrp &&
    existing.metroPrice === expected.metroPrice
  );
}

function textValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function skuValue(value: unknown): string | null {
  return textValue(value)?.toUpperCase() ?? null;
}

function priceValue(value: unknown): number | null {
  const text = textValue(value);
  if (text == null) return null;
  const parsed = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMasterCatalogueRows(rows: unknown[][]): MasterCatalogueParseResult {
  const [headerRow = [], ...dataRows] = rows;
  const headers = new Map(
    headerRow.map((header, index) => [textValue(header)?.toUpperCase() ?? '', index]),
  );
  const at = (row: unknown[], name: string): unknown => {
    const index = headers.get(name.toUpperCase());
    return index == null ? undefined : row[index];
  };

  const entries: MasterCatalogueSeedEntry[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skipped = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => textValue(value) == null)) {
      skipped += 1;
      return;
    }

    const description = textValue(at(row, 'Description'));
    const barcode = textValue(at(row, 'Barcode'));
    const brandName = textValue(at(row, 'Brand'));
    if (!description || !barcode || !brandName) {
      errors.push({ row: rowNumber, message: 'Description, barcode, and brand are required' });
      return;
    }

    entries.push({
      barcode,
      description,
      apiSku: skuValue(at(row, 'API PDE')),
      sigmaSku: skuValue(at(row, 'Sigma PDE')),
      ch2Sku: skuValue(at(row, 'CH2 PDE')),
      brandName,
      manufacturerName: textValue(at(row, 'Manufacturer')),
      category: textValue(at(row, 'Category')),
      subCategory: textValue(at(row, 'Sub-Category')),
      rrp: priceValue(at(row, 'RRP $')),
      metroPrice: priceValue(at(row, 'Metro $')),
    });
  });

  return { entries, skipped, errors };
}

export function parseMasterCatalogueWorkbook(workbookPath: string): MasterCatalogueParseResult {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { entries: [], skipped: 0, errors: [{ row: 1, message: 'Workbook has no sheets' }] };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    blankrows: true,
    raw: true,
  });
  return normalizeMasterCatalogueRows(rows);
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

  async seedMasterCatalogue(workbookPath: string): Promise<MasterCatalogueSeedResult> {
    if (!workbookPath.trim()) {
      throw new Error('A master catalogue workbook path is required');
    }
    if (
      process.env.NODE_ENV === 'production' &&
      path.basename(workbookPath).toLowerCase() === 'sample_100_ipa_price_brands.xlsx'
    ) {
      throw new Error('The 100-row sample workbook cannot be used as the production catalogue');
    }

    const parsed = parseMasterCatalogueWorkbook(workbookPath);
    const result: MasterCatalogueSeedResult = {
      inserted: 0,
      updated: 0,
      skipped: parsed.skipped,
      errors: [...parsed.errors],
    };

    for (const [index, entry] of parsed.entries.entries()) {
      try {
        const existing = await this.prisma.masterCatalogueEntry.findUnique({
          where: { barcode: entry.barcode },
        });
        if (existing && masterCatalogueEntryMatches(existing, entry)) {
          result.skipped += 1;
          continue;
        }
        await this.prisma.masterCatalogueEntry.upsert({
          where: { barcode: entry.barcode },
          create: entry,
          update: entry,
        });
        if (existing) result.updated += 1;
        else result.inserted += 1;
      } catch (error) {
        result.errors.push({
          row: index + 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
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
