import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-*/**',
      'node_modules/**',
      'concept/**',
      'test-results/**',
      'playwright-report/**',
      '.kilo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/physics/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['three', 'three/*', '../render/*', '../sim/*', '../ui/*', '../input/*'] },
      ],
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*', '../render/*', '../ui/*', '../input/*'] }],
    },
  },
);
