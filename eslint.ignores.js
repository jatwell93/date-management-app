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
  '**/.kilo/**', // Local planning/worktree artifacts are not part of runtime source
  '**/.agents/**', // Skill assets/examples are not part of app runtime lint scope
  '**/.github/skills/**', // Skill examples are reference content, not app source
  '**/shared/types/*.js', // Generated JS artifacts from TS sources
];
