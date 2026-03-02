/**
 * Export Excess Products Script
 *
 * Generates a CSV export of products that exceed the organization's tier limit.
 * Useful for backup before deletion during tier downgrades.
 *
 * Usage:
 *   npm run export:excess-products -- --org <org-id> [--tier <tier-level>]
 *
 * Options:
 *   --org, -o     Organization ID (required)
 *   --tier, -t    Target tier level (starter, professional, premium, concierge)
 *                 If not specified, uses current subscription tier
 *   --output, -f  Output file path (default: excess-products-{orgId}-{timestamp}.csv)
 *   --format, -f  Output format: csv or json (default: csv)
 *
 * Examples:
 *   npm run export:excess-products -- --org abc-123
 *   npm run export:excess-products -- --org abc-123 --tier starter
 *   npm run export:excess-products -- --org abc-123 --output ./backups/excess.csv
 */

import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { TIER_LIMITS, TierLevel } from '../src/types/subscription';
import { escapeCSVValue, stringifyCSV } from '../src/utils/csv';

interface ExportOptions {
  orgId: string;
  tier?: TierLevel;
  output?: string;
  format: 'csv' | 'json';
}

function parseArguments(): ExportOptions {
  const { values } = parseArgs({
    options: {
      org: { type: 'string', short: 'o' },
      organization: { type: 'string' },
      tier: { type: 'string', short: 't' },
      output: { type: 'string', short: 'f' },
      format: { type: 'string', default: 'csv' },
    },
    allowPositionals: true,
  });

  const orgId = values.org || values.organization;
  if (!orgId) {
    console.error('Error: --org parameter is required');
    console.error('Usage: npm run export:excess-products -- --org <org-id>');
    process.exit(1);
  }

  const tier = values.tier as TierLevel | undefined;
  if (tier && !['starter', 'professional', 'premium', 'concierge'].includes(tier)) {
    console.error(`Error: Invalid tier "${tier}". Must be one of: starter, professional, premium, concierge`);
    process.exit(1);
  }

  const format = values.format as 'csv' | 'json';
  if (format !== 'csv' && format !== 'json') {
    console.error(`Error: Invalid format "${format}". Must be csv or json`);
    process.exit(1);
  }

  return {
    orgId,
    tier,
    output: values.output,
    format,
  };
}

async function getMaxSkus(prisma: PrismaClient, orgId: string, tierOverride?: TierLevel): Promise<number> {
  // If tier override specified, use that tier's limit
  if (tierOverride) {
    const limit = TIER_LIMITS[tierOverride].max_skus;
    if (limit === null) {
      console.log(`Tier "${tierOverride}" has unlimited SKUs. No excess products to export.`);
      process.exit(0);
    }
    return limit;
  }

  // Otherwise, fetch current subscription tier
  const subscription = await prisma.subscriptionTier.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });

  if (!subscription) {
    console.error(`Error: No subscription found for organization ${orgId}`);
    process.exit(1);
  }

  const tierLevel = subscription.tierLevel as TierLevel;
  const limit = TIER_LIMITS[tierLevel].max_skus;

  if (limit === null) {
    console.log(`Current tier "${tierLevel}" has unlimited SKUs. No excess products to export.`);
    process.exit(0);
  }

  return limit;
}

async function getCurrentSkuCount(prisma: PrismaClient, orgId: string): Promise<number> {
  const usage = await prisma.organizationUsage.findUnique({
    where: { organizationId: orgId },
    select: { totalSkus: true },
  });

  return usage?.totalSkus || 0;
}

async function getExcessProducts(
  prisma: PrismaClient,
  orgId: string,
  maxSkus: number,
): Promise<Array<{
  id: number;
  sku: string;
  name: string;
  category: string | null;
  barcode: string;
  costPrice: number;
  createdAt: Date;
  inventoryCount: number;
}>> {
  // Get products beyond the limit, oldest first (for deletion priority)
  const products = await prisma.product.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'asc' },
    skip: maxSkus,
    include: {
      _count: {
        select: { inventoryItems: true },
      },
    },
  });

  return products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    barcode: p.barcode,
    costPrice: p.costPrice,
    createdAt: p.createdAt,
    inventoryCount: p._count.inventoryItems,
  }));
}

async function exportExcessProducts(options: ExportOptions): Promise<void> {
  const prisma = new PrismaClient();

  try {
    // Validate organization exists
    const org = await prisma.organization.findUnique({
      where: { id: options.orgId },
      select: { id: true, name: true },
    });

    if (!org) {
      console.error(`Error: Organization ${options.orgId} not found`);
      process.exit(1);
    }

    console.log(`Exporting excess products for organization: ${org.name} (${options.orgId})`);

    // Get max SKUs based on tier
    const maxSkus = await getMaxSkus(prisma, options.orgId, options.tier);
    console.log(`SKU limit: ${maxSkus}`);

    // Get current count
    const currentCount = await getCurrentSkuCount(prisma, options.orgId);
    console.log(`Current SKU count: ${currentCount}`);

    // Check if over limit
    const excessCount = currentCount - maxSkus;
    if (excessCount <= 0) {
      console.log(`Organization is within limits. No excess products to export.`);
      return;
    }

    console.log(`Excess products: ${excessCount}`);

    // Fetch excess products
    const excessProducts = await getExcessProducts(prisma, options.orgId, maxSkus);
    console.log(`Fetched ${excessProducts.length} excess products`);

    if (excessProducts.length === 0) {
      console.log('No excess products found.');
      return;
    }

    // Determine output file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `excess-products-${options.orgId}-${timestamp}.${options.format}`;
    const outputPath = options.output
      ? path.resolve(options.output)
      : path.join(process.cwd(), defaultFilename);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Format and write data
    if (options.format === 'json') {
      const data = {
        metadata: {
          organizationId: options.orgId,
          organizationName: org.name,
          maxSkus,
          currentSkuCount: currentCount,
          excessCount: excessCount,
          exportedAt: new Date().toISOString(),
        },
        products: excessProducts,
      };
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    } else {
      // CSV format
      const headers = ['id', 'sku', 'name', 'category', 'barcode', 'costPrice', 'createdAt', 'inventoryCount'];
      const csvRows = excessProducts.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category || '',
        barcode: p.barcode,
        costPrice: p.costPrice,
        createdAt: p.createdAt.toISOString(),
        inventoryCount: p.inventoryCount,
      }));

      const csvContent = stringifyCSV(headers, csvRows);
      fs.writeFileSync(outputPath, csvContent);
    }

    console.log(`\n✅ Export complete: ${outputPath}`);
    console.log(`   Format: ${options.format.toUpperCase()}`);
    console.log(`   Products exported: ${excessProducts.length}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Review the exported file to confirm products for deletion`);
    console.log(`   2. Use the UI or API to delete excess products`);
    console.log(`   3. Once totalSkus <= maxSkus (${maxSkus}), creation lock will be removed`);

  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the export
const options = parseArguments();
exportExcessProducts(options);
