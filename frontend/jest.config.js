// Standalone Jest config (decoupled from CRA/react-scripts).
//
// This is intentionally transitional: it keeps the existing ~54 test files
// (which use jest.* globals) green while the build moves to Vite. A follow-up
// (#291) ports these suites to Vitest, after which this file is removed.
//
// babel-jest with inline presets mirrors CRA's original transform most closely.
// Presets are inlined here (rather than in a root babel.config.js) so that
// Vite's @vitejs/plugin-react does not inherit a Babel config it shouldn't.
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  // Transform a few ESM-only packages that ship untranspiled (CRA did the same).
  transformIgnorePatterns: ['node_modules/(?!(uuid|react-router|react-router-dom)/)'],
  moduleNameMapper: {
    '^@shared/markdown$': '<rootDir>/../shared/domain/markdown.ts',
    '^uuid$': '<rootDir>/src/__mocks__/uuid.js',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|svg|webp|avif|woff|woff2|ttf|eot)$':
      '<rootDir>/src/__mocks__/fileMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['<rootDir>/src/**/*.(test|spec).(ts|tsx|js|jsx)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/service-worker.ts',
  ],
};
