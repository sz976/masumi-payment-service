import globals from 'globals';
import pluginJs from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: pluginJs.configs.recommended,
});

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Base config for all JS files
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: '@typescript-eslint/parser',

  parserOptions: {
    projectService: true,
    tsconfigRootDir: __dirname,
  },
    },
  },
  
  // JS recommended configs
  pluginJs.configs.recommended,
  // Use the compatibility layer to load the TypeScript plugin and recommended rules
  ...compat.extends(
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:prettier/recommended',
  ),
  // Add custom rules for TypeScript
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/no-explicit-any': ['off'],
      '@typescript-eslint/no-unsafe-assignment': ['error'],
      '@typescript-eslint/no-unsafe-argument': ['error'],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': ['off'],
      semi: ['error', 'always'],
    },
  },
  // Add Jest environment for test files
  {
    files: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
      },
    },
  },
  // Ignores
  {
    ignores: [
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/node_modules/**',
      'dist/*',
      'smart-contracts/*',
      'frontend/*',
      'eslint.config.mjs',
      'frontend/*',
      'commitlint.config.js',
      'jest.config.ts',
      'prisma/*',
    ],
  },
];
