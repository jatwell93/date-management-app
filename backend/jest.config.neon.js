/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testPathIgnorePatterns: ['<rootDir>/dist/'],
  testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
      },
    ],
  },
  globalSetup: '<rootDir>/test-setup-neon.js', // Use Neon setup
  globalTeardown: '<rootDir>/test-teardown-neon.js', // Restore SQLite schema
  setupFiles: ['<rootDir>/src/tests/setup-neon-env.ts'], // Use Neon env setup
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup-after-env.ts'],
  // Coverage configuration
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/tests/**',
    '!src/__mocks__/**',
    '!src/migrations/**',
    '!src/index.ts',
    '!src/config/**',
    '!src/utils/normalize.function.ts',
    '!src/utils/retry.ts',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  coverageDirectory: 'coverage',

  // Performance optimization
  maxWorkers: 1,
  testTimeout: 30000,
};
