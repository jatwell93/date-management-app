/**
 * Migration Script: Normalize Upload Status Values
 * 
 * Converts legacy 'complete' status to canonical 'completed' 
 * and ensures all uploads have valid status values.
 * 
 * Run with: npx ts-node scripts/migrate-upload-status.ts
 */

import { PrismaClient } from '@prisma/client';
import { UploadStatus } from '../src/types/upload.types';

const prisma = new PrismaClient();

async function migrateUploadStatus() {
  console.log('Starting upload status migration...');
  
  try {
    // Count records that need migration
    const legacyCompleteCount = await prisma.upload.count({
      where: {
        status: 'complete' // Legacy value
      }
    });

    console.log(`Found ${legacyCompleteCount} uploads with legacy 'complete' status`);

    if (legacyCompleteCount > 0) {
      // Update legacy 'complete' to canonical 'completed'
      const updateResult = await prisma.upload.updateMany({
        where: {
          status: 'complete'
        },
        data: {
          status: UploadStatus.COMPLETED
        }
      });

      console.log(`✓ Migrated ${updateResult.count} uploads to '${UploadStatus.COMPLETED}'`);
    } else {
      console.log('✓ No migration needed - all statuses are canonical');
    }

    // Verify no invalid statuses remain
    const validStatuses = Object.values(UploadStatus);
    const allUploads = await prisma.upload.findMany({
      select: { id: true, status: true }
    });

    const invalidUploads = allUploads.filter(u => !validStatuses.includes(u.status as any));
    
    if (invalidUploads.length > 0) {
      console.warn(`⚠ Warning: ${invalidUploads.length} uploads have invalid statuses:`);
      invalidUploads.forEach(u => {
        console.warn(`  - Upload ID ${u.id}: status="${u.status}"`);
      });
      console.warn('Valid statuses:', validStatuses);
    } else {
      console.log('✓ All upload statuses are valid');
    }

    // Verify storage quota consistency
    const inconsistentOrgs = await prisma.$queryRaw<Array<{ organizationId: string; quotaBytes: bigint; actualBytes: bigint }>>`
      SELECT 
        u.organization_id as "organizationId",
        COALESCE(MAX(ou.storage_used_bytes), 0) as "quotaBytes",
        COALESCE(SUM(u.file_size_bytes), 0) as "actualBytes"
      FROM uploads u
      LEFT JOIN organization_usage ou ON u.organization_id = ou.organization_id
      WHERE u.status = ${UploadStatus.COMPLETED}
      GROUP BY u.organization_id
      HAVING COALESCE(MAX(ou.storage_used_bytes), 0) != COALESCE(SUM(u.file_size_bytes), 0)
    `;

    if (inconsistentOrgs.length > 0) {
      console.warn(`⚠ Warning: ${inconsistentOrgs.length} organizations have quota/upload size mismatches:`);
      for (const org of inconsistentOrgs) {
        console.warn(`  - Org ${org.organizationId}: quota=${org.quotaBytes}, actual=${org.actualBytes}`);
      }
      console.warn('Run storage quota recalculation to fix.');
    } else {
      console.log('✓ Storage quotas are consistent with completed uploads');
    }

    console.log('\n✓ Migration completed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateUploadStatus()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
