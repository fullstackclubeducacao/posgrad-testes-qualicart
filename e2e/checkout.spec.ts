import { test, expect } from '@playwright/test';

/**
 * Jornada FELIZ de checkout, ponta a ponta.
 *
 * Exercita o sistema como um usuario real: abre a UI servida pelo checkout
 * (porta 3000), preenche o formulario, finaliza e verifica o total calculado.
 * Por baixo, o checkout consulta o catalogo (porta 3001) por HTTP para
 * resolver os precos — ou seja, esta unica jornada atravessa navegador,
 * servico de checkout, logica de negocio e servico de catalogo.
 *
 * Carrinho fixo servido pela UI: Camiseta (R$ 59,90 x2) + Caneca (R$ 39,90 x1).
 *   Subtotal ...... 159,70
 *   Cupom 10% ..... -15,97  -> subtotal com desconto 143,73
 *   Frete (CEP 0x)  +15,00  (< R$200, regiao proxima)
 *   Total ......... 158,73
 */
test('checkout feliz: finaliza o pedido e mostra o total calculado', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'QualiCart' })).toBeVisible();

  // Antes de finalizar, o total ainda esta pendente.
  const total = page.locator('#resultado-total');
  await expect(total).toHaveAttribute('data-status', 'pendente');

  // Preenche o formulario como um usuario (labels associadas aos inputs).
  await page.getByLabel('Cupom de desconto').fill('DESCONTO10');
  await page.getByLabel('CEP de entrega').fill('01000-000');

  await page.getByRole('button', { name: 'Finalizar' }).click();

  // O resultado do checkout aparece na tela.
  await expect(total).toHaveAttribute('data-status', 'ok');
  await expect(total).toHaveText('R$ 158.73');

  // O resumo detalhado tambem confere (subtotal, desconto, frete e total).
  const resumo = page.locator('#resultado');
  await expect(resumo).toContainText('Subtotal: R$ 159.70');
  await expect(resumo).toContainText('Desconto: R$ 15.97');
  await expect(resumo).toContainText('Frete: R$ 15.00');
  await expect(resumo).toContainText('Total: R$ 158.73');
});
