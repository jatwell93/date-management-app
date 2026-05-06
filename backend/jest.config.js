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
  globalSetup: '<rootDir>/test-setup.js',
  setupFiles: ['<rootDir>/src/tests/setup-env.ts'],
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
  // Coverage thresholds enforcement
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 70,
      functions: 75,
      lines: 75,
    },
  },

  // Performance optimization
  maxWorkers: 1,
  testTimeout: 30000,
};
