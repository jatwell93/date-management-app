const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');
const importPlugin = require('eslint-plugin-import');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

const vitestGlobals = {
  afterAll: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  it: 'readonly',
  test: 'readonly',
  vi: 'readonly',
};

const baseTsRules = {
  ...tsPlugin.configs.recommended.rules,
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-require-imports': 'off',
  'prettier/prettier': 'error',
};

const baseJsRules = {
  'no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  'prettier/prettier': 'error',
};

module.exports = [
  { ignores: require('./eslint.ignores.js') },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,jsx}'],
  },
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  {
    files: [
      'frontend/src/**/*.test.{js,jsx,ts,tsx}',
      'frontend/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
      'frontend/src/setupTests.{js,jsx,ts,tsx}',
      'frontend/src/test-utils/**/*.{js,jsx,ts,tsx}',
      'frontend/src/__mocks__/**/*.{js,jsx,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...vitestGlobals,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-redeclare': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: baseTsRules,
  },
  {
    files: ['e2e/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: baseTsRules,
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      prettier: prettierPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: {
          project: ['./frontend/tsconfig.json'],
        },
      },
    },
    rules: {
      ...baseTsRules,
      ...reactPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['scripts/**/*.{js,jsx}', '*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.node,
    },
    plugins: { prettier: prettierPlugin },
    rules: baseJsRules,
  },
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
        module: 'readonly',
        exports: 'readonly',
      },
    },
    plugins: { prettier: prettierPlugin },
    rules: baseJsRules,
  },
  {
    files: ['frontend/src/__mocks__/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.jest,
        module: 'readonly',
      },
    },
    plugins: { prettier: prettierPlugin },
    rules: baseJsRules,
  },
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      prettier: prettierPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...baseJsRules,
      ...reactPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      '**/*.config.js',
      '**/craco.config.js',
      '**/postcss.config.js',
      '**/.prettierrc.js',
      '**/tailwind.config.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.node,
    },
    plugins: { prettier: prettierPlugin },
    rules: baseJsRules,
  },
  {
    files: ['brand-identity/**/*.{ts,tsx}', 'frontend/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
      react: reactPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...baseTsRules,
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: [
      'frontend/src/**/*.test.{js,jsx,ts,tsx}',
      'frontend/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
      'frontend/src/setupTests.{js,jsx,ts,tsx}',
      'frontend/src/test-utils/**/*.{js,jsx,ts,tsx}',
      'frontend/src/tests/**/*.{js,jsx,ts,tsx}',
      'frontend/src/__mocks__/**/*.{js,jsx,ts,tsx}',
      'frontend/src/**/*.d.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...vitestGlobals,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['scripts/**/*.test.js'],
    rules: {
      'no-redeclare': 'off',
    },
  },
  // Complexity guard for new code. CodeScene's PR gate fails on complex,
  // deeply nested functions, and agents cannot run CodeScene locally, so lint
  // catches the worst cases before a push. The limits are deliberately loose
  // (ESLint counts differently from CodeScene): they stop 20+ complexity
  // monsters, not borderline functions. Existing offenders are listed in
  // eslint.complexity-baseline.js and skipped; tests are not checked.
  {
    files: ['scripts/**/*.js', 'shared/**/*.{js,ts}', 'frontend/src/**/*.{js,jsx,ts,tsx}', '*.js'],
    ignores: [
      ...require('./eslint.complexity-baseline.js'),
      '**/*.test.{js,jsx,ts,tsx}',
      '**/__tests__/**',
      '**/__mocks__/**',
      'frontend/src/tests/**',
      'frontend/src/test-utils/**',
      'frontend/src/setupTests.{js,jsx,ts,tsx}',
    ],
    rules: {
      complexity: ['error', 8],
      'max-depth': ['error', 3],
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: prettierConfig.rules,
  },
];
