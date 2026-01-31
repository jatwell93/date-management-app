/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/dist/'],
  testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: true,
    }],
  },
  globalSetup: '<rootDir>/test-setup.js',
  setupFiles: ['<rootDir>/src/tests/setup-env.ts'],
  // Coverage configuration
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/tests/**',
    '!src/__mocks__/**',
    '!src/migrations/**',
    '!src/index.ts',
    '!src/config/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  
  // Performance optimization
  maxWorkers: '50%',
  testTimeout: 30000,
};
