import { test, expect } from '@playwright/test';

/**
 * Visual regression da pagina de checkout.
 *
 * Captura a pagina inteira em estado inicial estavel (sem submit, animacoes
 * desabilitadas via config) e compara com a baseline versionada em
 * `e2e/visual.spec.ts-snapshots/`. Qualquer diferenca visual acima do
 * threshold (maxDiffPixelRatio) derruba o teste e gera um diff em
 * `test-results/`.
 */
test('checkout mantem o layout esperado @visual', async ({ page }) => {
  await page.goto('/');

  // Garante que o estado inicial esta renderizado antes da captura.
  await expect(
    page.getByRole('heading', { name: 'QualiCart' }),
  ).toBeVisible();

  await expect(page).toHaveScreenshot('checkout.png', {
    fullPage: true,
  });
});
