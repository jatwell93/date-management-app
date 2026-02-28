#!/usr/bin/env npx ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TABLES_TO_CHECK = [
  { model: 'product', tableName: 'products' },
  { model: 'inventoryItem', tableName: 'inventory_items' },
  { model: 'storeArea', tableName: 'store_areas' },
  { model: 'user', tableName: 'users' },
  { model: 'upload', tableName: 'uploads' },
  { model: 'auditLog', tableName: 'audit_log' },
  { model: 'itemTransaction', tableName: 'item_transactions' },
  { model: 'expiredItemTransaction', tableName: 'expired_item_transactions' },
];

interface TableResult {
  table: string;
  totalRows: number;
  nullOrgId: number;
  orphanOrgId: number;
  status: '✅ PASS' | '❌ FAIL' | '⚠️  UNKNOWN';
}

async function auditOrganizationIds(): Promise<TableResult[]> {
  const results: TableResult[] = [];

  console.log('\n🔍 Auditing organizationId assignments across all tables...\n');

  for (const table of TABLES_TO_CHECK) {
    try {
      const [totalResult, nullResult, orphanResult] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
          `SELECT COUNT(*) as count FROM "${table.tableName}"`,
        ),
        prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
          `SELECT COUNT(*) as count FROM "${table.tableName}" WHERE organization_id IS NULL`,
        ),
        prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
          `SELECT COUNT(*) as count FROM "${table.tableName}" p WHERE p.organization_id IS NOT NULL AND p.organization_id NOT IN (SELECT id FROM organizations)`,
        ),
      ]);

      const totalRows = Number(totalResult[0]?.count ?? 0);
      const nullOrgId = Number(nullResult[0]?.count ?? 0);
      const orphanOrgId = Number(orphanResult[0]?.count ?? 0);

      const status = nullOrgId === 0 && orphanOrgId === 0 ? '✅ PASS' : '❌ FAIL';

      results.push({
        table: table.model,
        totalRows,
        nullOrgId,
        orphanOrgId,
        status,
      });

      console.log(
        `  ${status} ${table.model.padEnd(22)} | Total: ${totalRows.toString().padStart(6)} | NULL orgId: ${nullOrgId.toString().padStart(5)} | Orphans: ${orphanOrgId.toString().padStart(5)}`,
      );

      if (nullOrgId > 0 || orphanOrgId > 0) {
        try {
          if (nullOrgId > 0) {
            const nullRows = await prisma.$queryRawUnsafe<Array<{ id: number | string }>>(
              `SELECT id FROM "${table.tableName}" WHERE organization_id IS NULL LIMIT 10`,
            );
            console.log(
              `      → First 10 NULL organization_id IDs: ${nullRows.map((r) => r.id).join(', ')}`,
            );
          }

          if (orphanOrgId > 0) {
            const orphanRows = await prisma.$queryRawUnsafe<Array<{ id: number | string }>>(
              `SELECT id FROM "${table.tableName}" WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM organizations) LIMIT 10`,
            );
            console.log(
              `      → First 10 orphan organization_id IDs: ${orphanRows.map((r) => r.id).join(', ')}`,
            );
          }
        } catch {
          console.log(`      → Could not retrieve offending row IDs`);
        }
      }
    } catch (error) {
      console.log(
        `  ⚠️  ${table.model.padEnd(22)} | Table may not exist or schema not migrated yet`,
      );
      results.push({
        table: table.model,
        totalRows: 0,
        nullOrgId: -1,
        orphanOrgId: -1,
        status: '⚠️  UNKNOWN',
      });
    }
  }

  return results;
}

async function main() {
  let exitCode = 0;

  try {
    const results = await auditOrganizationIds();

    const failedTables = results.filter((r) => r.status === '❌ FAIL');
    const unknownTables = results.filter((r) => r.status === '⚠️  UNKNOWN');

    console.log('\n' + '='.repeat(80));

    if (failedTables.length > 0) {
      console.log(
        '\n❌ AUDIT FAILED: The following tables have NULL or orphan organizationId values:',
      );
      failedTables.forEach((t) =>
        console.log(`   - ${t.table}: ${t.nullOrgId} NULL, ${t.orphanOrgId} orphans`),
      );
      console.log('\n→ Stop! Backfill organizationId values before making columns NOT NULL.');
      exitCode = 1;
    } else if (unknownTables.length > 0) {
      console.log('\n⚠️  AUDIT SKIPPED: Some tables do not exist yet (schema not migrated).');
      console.log('→ Run migrations first: npx prisma migrate dev');
      exitCode = 1;
    } else {
      console.log('\n✅ All records have organizationId assigned correctly!');
      console.log('→ Safe to proceed with making organizationId NOT NULL.');
    }

    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n❌ Audit script error:', error);
    exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
