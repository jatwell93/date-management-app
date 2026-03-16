const path = require('path');
const fs = require('fs');

const defaultSchema = path.join(__dirname, 'prisma', 'schema.prisma');
const backupSchema = defaultSchema + '.sqlite.bak';

module.exports = async () => {
  // Stop background services and disconnect Prisma client after Neon tests complete

  try {
    // Stop application monitoring service to prevent background logging
    const { ApplicationMonitoringService } = require('./src/services/application.monitoring.service');
    const monitoringService = ApplicationMonitoringService.getInstance();
    monitoringService.stopMonitoring(true); // silent if not running
    console.log('\n✓ Stopped application monitoring service');
  } catch (error) {
    console.warn('⚠️  Failed to stop application monitoring service:', error.message);
  }

  try {
    // Stop database monitoring service to prevent background logging
    const { DatabaseMonitoringService } = require('./src/services/database.monitoring.service');
    const dbMonitoringService = DatabaseMonitoringService.getInstance();
    dbMonitoringService.stopMonitoring(true); // silent if not running
    console.log('✓ Stopped database monitoring service');
  } catch (error) {
    console.warn('⚠️  Failed to stop database monitoring service:', error.message);
  }

  try {
    // Disconnect Prisma client to prevent connection logging after tests
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$disconnect();
    console.log('✓ Disconnected Prisma client');
  } catch (error) {
    console.warn('⚠️  Failed to disconnect Prisma client:', error.message);
  }

  try {
    if (fs.existsSync(backupSchema)) {
      fs.copyFileSync(backupSchema, defaultSchema);
      console.log('✓ Restored SQLite schema after Neon tests');
    } else {
      console.warn('\n⚠️  SQLite schema backup missing during Neon teardown.');
      console.warn('   Restore manually: copy prisma/schema.prisma.sqlite.bak to prisma/schema.prisma');
    }
  } catch (error) {
    console.warn('⚠️  Failed to restore SQLite schema:', error.message);
  }
};
