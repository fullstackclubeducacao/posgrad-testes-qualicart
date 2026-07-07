import { defineConfig, devices } from '@playwright/test';

/**
 * Configuracao de E2E do QualiCart (Modulo 2).
 *
 * Sobe automaticamente os DOIS servicos antes dos testes (catalogo + checkout)
 * via `webServer` e roda a jornada critica de checkout no chromium.
 *
 * Portas fixas nesta suite: 3001 (catalogo) e 3000 (checkout).
 */
export default defineConfig({
  testDir: 'e2e',
  // Falha se alguem esquecer um test.only no CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Uma jornada, um worker: E2E e caro e nao precisa de paralelismo aqui.
  workers: 1,
  reporter: 'list',

  // Visual regression: tolera micro-diferencas de renderizacao (antialiasing,
  // sub-pixel) mas pega mudancas visuais reais. Combinado com animacoes off
  // e ambiente consistente (chromium fixo), doma a fragilidade das capturas.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Desabilita animacoes: deixa o terreno pronto para o visual
        // regression do Modulo 3 (capturas estaveis, sem flutuacao).
        launchOptions: {
          args: ['--force-prefers-reduced-motion'],
        },
      },
    },
  ],

  // O Playwright sobe e derruba os servicos automaticamente.
  webServer: [
    {
      command: 'CATALOG_PORT=3001 node packages/catalog/src/server.ts',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        'PORT=3000 CATALOG_URL=http://localhost:3001 node packages/checkout/src/server.ts',
      url: 'http://localhost:3000/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
