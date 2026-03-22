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
    files: ['backend/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
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
    files: ['backend/**/*.{js,jsx}', 'scripts/**/*.{js,jsx}', '*.js'],
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
    files: ['backend/scripts/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      ...baseJsRules,
      'no-case-declarations': 'off',
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: prettierConfig.rules,
  },
];
