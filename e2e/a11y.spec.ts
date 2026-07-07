import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Gate de acessibilidade da pagina de checkout.
 *
 * Roda o axe-core (motor de auditoria de a11y) contra a UI servida em `/` e
 * FALHA se houver qualquer violacao de severidade `serious` ou `critical`.
 * Violacoes `minor`/`moderate` sao reportadas (para inspecao humana) mas nao
 * derrubam o build — o gate mira o que quebra a experiencia de fato.
 */
test('checkout sem violacoes de acessibilidade serias @a11y', async ({
  page,
}) => {
  await page.goto('/');

  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const seriasOuCriticas = resultado.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );

  // Mensagem legivel no relatorio quando algo quebra o gate.
  const resumo = seriasOuCriticas
    .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} no(s))`)
    .join('\n');

  expect(seriasOuCriticas, `Violacoes serias/criticas encontradas:\n${resumo}`)
    .toEqual([]);
});
