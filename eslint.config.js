import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import pluginSecurity from 'eslint-plugin-security';

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
  // SAST (shift-left): eslint-plugin-security roda análise estática em busca de
  // padrões perigosos (injeção de objeto, uso de child_process, regex ReDoS,
  // caminhos de arquivo não-literais, etc.). É a nossa camada de SAST barata,
  // executada no mesmo gate de lint. Aplicada a todo o código fonte/scripts.
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    ...pluginSecurity.configs.recommended,
  },
  {
    // INTENÇÃO das severidades de segurança (igual ao critério de complexidade):
    // mantemos as regras como "warn", não "error". Assim o SAST SINALIZA todo
    // achado (o sinal aparece no lint e nos logs do CI) sem transformar cada
    // falso positivo em um bloqueio do gate local. O gate de segurança que
    // FALHA o build de fato é o SCA (`npm audit --audit-level=high`) mais o
    // job dedicado de SAST no CI, que revisa a saída. Achados reais avaliados
    // e classificados como falso positivo seguro estão documentados em
    // docs/modulo-3/seguranca-pipeline.md (ex.: detect-non-literal-fs-filename
    // ao ler o schema.sql a partir de um caminho fixo relativo ao módulo).
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    rules: {
      // Propenso a falso positivo em acesso legítimo por chave (ex.: mapa de
      // flags/estratégias indexado por string interna, não por input do usuário).
      'security/detect-object-injection': 'warn',
      // Leitura de arquivo com caminho não-literal: só é risco se o caminho vier
      // de entrada não confiável. Nos nossos casos o caminho é fixo/derivado do
      // próprio módulo (import.meta.url), então é sinal, não erro.
      'security/detect-non-literal-fs-filename': 'warn',
    },
  },
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
