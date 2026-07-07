import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
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
);
