const path = require('path');
const fs = require('fs');

module.exports = async () => {
  // Restore SQLite schema and regenerate client after Neon tests complete
  const defaultSchema = path.join(__dirname, 'prisma', 'schema.prisma');
  const backupSchema = defaultSchema + '.sqlite.bak';

  if (fs.existsSync(backupSchema)) {
    try {
      fs.copyFileSync(backupSchema, defaultSchema);
      console.log('\n✓ Restored SQLite schema after Neon tests');
    } catch (error) {
      console.warn('⚠️  Failed to restore SQLite schema:', error.message);
    }
  }
};
