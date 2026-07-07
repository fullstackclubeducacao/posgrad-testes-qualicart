import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'reports/**',
      '.stryker-tmp/**',
      'test-results/**',
      'playwright-report/**',
      'pacts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Código, testes e scripts rodam no Node — habilita os globais do Node
    // (console, fetch, setTimeout, performance, crypto, process, ...).
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Regras de complexidade usadas como detectores de code smells.
      // Ficam como "warn" de proposito: o starter tem smells intencionais
      // e o lint nao deve quebrar por causa deles.
      complexity: ['warn', { max: 8 }],
      'max-depth': ['warn', { max: 3 }],
      'max-lines-per-function': ['warn', { max: 40 }],
      'max-params': ['warn', { max: 4 }],
    },
  },
  {
    // Scripts de carga do k6 rodam no runtime do k6 (não no Node): expõem
    // globais próprios como __ENV/__VU e importam de módulos virtuais 'k6/*'.
    files: ['load/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
    },
  },
);
