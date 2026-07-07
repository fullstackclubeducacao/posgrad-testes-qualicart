# Acessibilidade + Visual Regression (Módulo 3 — item 5)

Este documento cobre dois tipos de teste que os testes funcionais **não** substituem:
um **gate de acessibilidade** com `axe-core` e um **teste de regressão visual** com o
`toHaveScreenshot` do Playwright. Ambos rodam sobre a página de checkout
(`packages/checkout/public/index.html`, servida em `/`).

Arquivos desta entrega:

- `e2e/a11y.spec.ts` — gate de acessibilidade (`@a11y`).
- `e2e/visual.spec.ts` — regressão visual (`@visual`).
- `e2e/visual.spec.ts-snapshots/checkout-chromium-darwin.png` — baseline versionada.
- `playwright.config.ts` — `expect.toHaveScreenshot.maxDiffPixelRatio`.
- `packages/checkout/public/index.html` — página corrigida (a11y) + estilizada.

Scripts (já existentes no `package.json`):

```
npm run test:a11y     # playwright test --grep @a11y
npm run test:visual   # playwright test --grep @visual
npm run test:e2e      # roda tudo (a11y + visual + jornada feliz)
```

---

## Parte A — Acessibilidade como qualidade

### Por que isso é um gate, e não um "extra"

Acessibilidade **não é caridade** — é qualidade e, em muitos contextos, **exigência
legal** (no Brasil, a Lei Brasileira de Inclusão / LBI nº 13.146/2015; lá fora, ADA,
EN 301 549, European Accessibility Act). Uma página que um leitor de tela não consegue
navegar, ou cujo texto some por baixo contraste, está **quebrada** para uma parcela real
de usuários — exatamente como um bug funcional.

O ponto honesto: ferramentas automáticas como o `axe-core` cobrem apenas **~30–40%** das
regras da WCAG. Elas pegam o que é verificável por máquina (contraste, `lang`, rótulos,
landmarks, ordem de headings, `alt` em imagens). O resto — se a ordem de foco faz sentido,
se um `alt` **descreve** a imagem em vez de só existir, se o fluxo é usável só com teclado —
exige **teste humano**. Portanto o axe é um **piso automatizável**, não o teto. Ele barra
regressões óbvias no CI e libera o humano para o julgamento que só o humano faz.

### O teste (`e2e/a11y.spec.ts`)

Usa `@axe-core/playwright`. Roda o scan na página `/` e **falha se houver qualquer
violação de severidade `serious` ou `critical`**. Violações `minor`/`moderate` são
reportadas mas não derrubam o build — o gate mira o que quebra a experiência de fato.

```ts
const resultado = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .analyze();

const seriasOuCriticas = resultado.violations.filter(
  (v) => v.impact === 'serious' || v.impact === 'critical',
);
expect(seriasOuCriticas).toEqual([]);
```

### A violação REAL encontrada e corrigida

Ao estilizar a página, os textos de apoio dos campos (`<span class="ajuda">`) receberam
uma cor cinza-claro (`#c4c9ce`) sobre fundo branco — um erro de design **muito comum**.
O `axe-core` reprovou:

**Saída real do axe (ANTES da correção):**

```
=== VIOLATIONS ===
[serious] color-contrast: Elements must meet minimum color contrast ratio thresholds
   | https://dequeuniversity.com/rules/axe/4.12/color-contrast
   node: [ 'p:nth-child(1) > span' ] :: Element has insufficient color contrast of 1.66
          (foreground color: #c4c9ce, background color: #ffffff, font size: 9.8pt (13px),
          font weight: normal). Expected contrast ratio of 4.5:1
   node: [ 'p:nth-child(2) > span' ] :: Element has insufficient color contrast of 1.66
          (foreground color: #c4c9ce, background color: #ffffff, ...). Expected 4.5:1
```

E o gate `@a11y` falhou como esperado:

```
Error: Violacoes serias/criticas encontradas:
- [serious] color-contrast: Elements must meet minimum color contrast ratio thresholds (2 no(s))
```

**A correção:** trocar `#c4c9ce` (contraste 1,66:1 — reprovado) por `#6b7480`
(variável `--texto-suave`), que rende **> 4,5:1** sobre branco, atendendo a WCAG 2 AA para
texto normal.

```css
.ajuda {
  /* antes: color: #c4c9ce;  -> reprovado pelo axe (color-contrast, serious) */
  color: var(--texto-suave); /* #6b7480, contraste >= 4.5:1 */
}
```

**Saída real do gate (DEPOIS da correção):**

```
✓  1 [chromium] › e2e/a11y.spec.ts:12:1 › checkout sem violacoes de acessibilidade serias @a11y (204ms)
  1 passed (1.7s)
```

> A página já trazia boas práticas (`<html lang="pt-BR">`, landmark `<main>`, `<label for>`
> associado a cada `<input>`, hierarquia de headings `h1 → h2`). O contraste foi a violação
> **séria** real introduzida pela camada visual e corrigida — o cenário mais frequente em
> apps reais assim que alguém "dá um trato no CSS".

---

## Parte B — Regressão visual

### O que os testes funcionais NÃO pegam

A jornada feliz (`e2e/checkout.spec.ts`) verifica **comportamento**: preenche o formulário,
finaliza, confere o total. Ela passa **mesmo que o layout esteja destruído** — botão
invisível, cores erradas, texto sobreposto, CSS que não carregou. Nada disso muda o
`data-status` nem o total. Regressão visual cobre justamente essa lacuna: compara um
**pixel a pixel** da tela contra uma **baseline** aprovada.

### O teste (`e2e/visual.spec.ts`)

```ts
await expect(page).toHaveScreenshot('checkout.png', { fullPage: true });
```

A baseline fica versionada em `e2e/visual.spec.ts-snapshots/checkout-chromium-darwin.png`
(o nome inclui projeto + SO, porque a renderização varia entre plataformas).

### Domando a fragilidade

Screenshot testing tem fama de ser "flaky". Três medidas neutralizam isso:

1. **Ambiente consistente** — sempre o mesmo browser (Chromium) e o `webServer` do
   Playwright sobe os serviços de forma idêntica. O sufixo `-chromium-darwin` no nome
   deixa explícito que a baseline é acoplada à plataforma (no CI, gere a baseline no
   mesmo SO do runner).
2. **Animações desligadas** — o `playwright.config.ts` já passa
   `--force-prefers-reduced-motion`, então não há frames "no meio" da captura.
3. **Threshold sensato** — `maxDiffPixelRatio: 0.01` tolera micro-diferenças de
   antialiasing/sub-pixel, mas ainda pega mudanças visuais reais.

```ts
// playwright.config.ts
expect: {
  toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
},
```

### O ciclo baseline → diff → aprovação (com saídas reais)

**1. Gerar a baseline** (`npm run test:visual -- --update-snapshots`):

```
A snapshot doesn't exist at .../checkout-chromium-darwin.png, writing actual.
✓  1 [chromium] › e2e/visual.spec.ts › checkout mantem o layout esperado @visual
  1 passed
```

**2. Uma mudança visual proposital** — o `<h1>` deixou de ser um título com borda
inferior e virou uma **barra sólida colorida** (fundo `--azul`, texto branco). Rodando
`npm run test:visual`, o teste **FALHA** e aponta o diff:

```
✘  1 [chromium] › e2e/visual.spec.ts:12:1 › checkout mantem o layout esperado @visual
   Error: expect(page).toHaveScreenshot(expected) failed
     Expected an image 1280px by 915px, received 1280px by 912px.
     49629 pixels (ratio 0.05 of all image pixels) are different.
   Expected: e2e/visual.spec.ts-snapshots/checkout-chromium-darwin.png
   Diff:     test-results/visual-.../checkout-diff.png
  1 failed
```

O Playwright grava três artefatos em `test-results/.../`:
`checkout-expected.png` (baseline), `checkout-actual.png` (atual) e
`checkout-diff.png` (as diferenças destacadas). O `ratio 0.05` (5%) estourou o limiar de
`0.01` (1%) — mudança visual **real**, não ruído.

**3. Decisão humana: a mudança é INTENCIONAL** — o redesenho da barra do cabeçalho é
desejado, então **aprovamos a nova baseline** (`npm run test:visual -- --update-snapshots`):

```
.../checkout-chromium-darwin.png is re-generated, writing actual.
✓  1 [chromium] › e2e/visual.spec.ts › checkout mantem o layout esperado @visual
  1 passed
```

Re-rodando limpo, bate de novo:

```
✓  1 [chromium] › e2e/visual.spec.ts:12:1 › checkout mantem o layout esperado @visual (114ms)
  1 passed (1.6s)
```

> **A lição do ciclo:** o teste visual **não sabe** se uma mudança é bug ou melhoria — ele
> só sabe que algo mudou. A baseline é a "verdade aprovada por um humano". Quando o diff
> aparece, alguém decide: *regressão* (corrige o código) ou *intencional* (aprova a nova
> baseline com `--update-snapshots`). Nunca aprove baseline no automático — isso esvazia o
> teste.

---

## Estado final — tudo verde

```
Running 3 tests using 1 worker
  ✓  1 e2e/a11y.spec.ts     › checkout sem violacoes de acessibilidade serias @a11y (216ms)
  ✓  2 e2e/checkout.spec.ts › checkout feliz: finaliza o pedido e mostra o total calculado (109ms)
  ✓  3 e2e/visual.spec.ts   › checkout mantem o layout esperado @visual (102ms)
  3 passed (2.0s)
```

- `npm run test:a11y` → VERDE (sem violações sérias/críticas após corrigir o contraste).
- `npm run test:visual` → VERDE (baseline consistente com o `index.html` final).
- `npm run test:e2e` → VERDE (jornada feliz preservada).
- Portas 3000/3001 liberadas ao fim (o `webServer` do Playwright derruba os serviços).
