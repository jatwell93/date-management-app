module.exports = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/.turbo/**',
  '**/.next/**',
  '**/frontend/build/**',
  '**/backend/dist/**',
  '**/uploads/**',
  '**/backups/**',
  '**/*.sqlite',
  '**/*.sqlite-*',
  '**/prisma/*.db',
  '**/workers/**', // Workers has its own separate config
];
