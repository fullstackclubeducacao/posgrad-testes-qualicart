# Mutation Testing no QualiCart

## O que é mutation testing (e por que ele responde o que a cobertura não responde)

A **cobertura de código** (coverage) mede *quais linhas foram executadas* pela
suíte de testes. Ela responde à pergunta: "meu teste passou por este código?".
Mas ela **não** responde à pergunta que realmente importa: "se este código
estivesse errado, algum teste reclamaria?".

É perfeitamente possível ter 100% de cobertura e, mesmo assim, uma suíte que não
verifica nada de útil — basta executar o código sem fazer asserções sobre o
resultado, ou fazer asserções fracas que não exercem as fronteiras.

O **mutation testing** ataca exatamente esse ponto cego. A ferramenta (aqui, o
**Stryker**) introduz pequenas alterações no código de produção — os
**mutantes** — como trocar `>` por `>=`, `+` por `-`, remover uma chamada de
método, inverter um `return`, etc. Para cada mutante, ela roda a suíte de testes:

- Se **algum teste falha**, o mutante foi **morto (killed)** — ótimo, a suíte
  detectou a regressão.
- Se **todos os testes passam** apesar da mutação, o mutante **sobreviveu
  (survived)** — isso denuncia um **furo na suíte**: existe um comportamento que
  ninguém está verificando.

O **mutation score** é a fração de mutantes mortos. Ele é uma métrica muito mais
honesta da qualidade dos testes do que a cobertura.

## Configuração

O Stryker está configurado em [`stryker.config.json`](../../stryker.config.json)
na raiz do projeto:

- **`testRunner: "command"`** com `commandRunner.command: "npm test"`. Como não
  há plugin de Stryker para o test runner nativo do Node (`node --test`), o
  *command runner* é o caminho: ele simplesmente roda a suíte de unidade e olha
  o código de saída do processo.
- **`coverageAnalysis: "off"`** — o command runner não suporta análise por teste
  (`perTest`), então roda a suíte inteira para cada mutante.
- **`mutate`** aponta para o **núcleo de preços**: `coupon.ts`, `cart.ts` e
  `shipping.ts`.
- **`reporters: ["clear-text", "html"]`** — o relatório HTML navegável é gerado
  em [`reports/mutation/`](../../reports/mutation/index.html).

Comando: `npm run test:mutation` (equivale a `stryker run`).

## Relatório ANTES: o mutante sobrevivente na fronteira do frete

Rodando `npm run test:mutation` com a suíte de unidade herdada do Módulo 1,
o Stryker instrumentou 54 mutantes e encontrou **3 sobreviventes**. O que nos
interessa é este, na **condição do limiar de frete grátis**:

```
[Survived] EqualityOperator
packages/checkout/src/shipping.ts:13:7
-     if (subtotal > LIMIAR_FRETE_GRATIS) {
+     if (subtotal >= LIMIAR_FRETE_GRATIS) {
```

Placar inicial (trecho real do clear-text):

```
-------------|--------|---------|----------|-----------|------------|----------|----------|
File         |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-------------|--------|---------|----------|-----------|------------|----------|----------|
All files    |  94.44 |   94.44 |       51 |         0 |          3 |        0 |        0 |
 cart.ts     | 100.00 |  100.00 |        4 |         0 |          0 |        0 |        0 |
 coupon.ts   |  96.55 |   96.55 |       28 |         0 |          1 |        0 |        0 |
 shipping.ts |  90.48 |   90.48 |       19 |         0 |          2 |        0 |        0 |
-------------|--------|---------|----------|-----------|------------|----------|----------|
```

**Mutation score inicial: 94.44%** no total; **shipping.ts em 90.48%**.

## Análise: o furo na suíte revela um bug de fronteira

Por que o Stryker consegue trocar `>` por `>=` na linha 13 sem que **nenhum**
teste reclame? Porque a suíte do Módulo 1 só testava valores **claramente**
acima (R$300, R$500) e **claramente** abaixo (R$50, R$150) do limiar — nunca o
valor **exato** da fronteira, R$200.

Com `>` e com `>=`, todos esses casos "longe da fronteira" dão o mesmo
resultado. O único valor que distingue as duas versões é exatamente R$200:

- `subtotal > 200` → em R$200 é `false` → **cobra frete**.
- `subtotal >= 200` → em R$200 é `true` → **frete grátis**.

Como ninguém testou R$200, o mutante passa despercebido. E ao inspecionar a
fronteira percebemos algo pior: a regra de negócio, documentada no próprio
código ("Acima do limiar de frete grátis (R$200), o frete é zero" / "a regra
deveria liberar frete grátis **a partir de** R$200"), diz que em R$200 o frete
deveria ser **grátis**. Mas o código usava `>`, então em exatamente R$200 o
cliente **pagava** frete. **O mutante sobrevivente denunciou um bug de fronteira
real.**

## Correção: teste de fronteira + `>` → `>=`

1. Adicionamos em
   [`packages/checkout/test/unit/shipping.test.ts`](../../packages/checkout/test/unit/shipping.test.ts)
   um teste que fixa o comportamento **correto** na fronteira — subtotal
   exatamente R$200 deve resultar em frete **0** — mais um teste do outro lado
   da fronteira (R$199,99 ainda cobra frete):

   ```ts
   it('libera frete gratis no subtotal EXATAMENTE no limiar (R$200)', () => {
     assert.equal(calcularFrete(200, '01001000'), 0);
     assert.equal(calcularFrete(200, '99000000'), 0);
   });
   ```

   Contra o código com o bug, esse teste **falha** (retorna 15, esperado 0),
   provando que ele de fato exerce a fronteira.

2. Corrigimos [`packages/checkout/src/shipping.ts`](../../packages/checkout/src/shipping.ts)
   com a menor mudança possível — trocar `>` por `>=`:

   ```diff
   - if (subtotal > LIMIAR_FRETE_GRATIS) {
   + if (subtotal >= LIMIAR_FRETE_GRATIS) {
   ```

3. `npm test` volta a ficar **verde** (30 testes), agora cobrindo a fronteira.

## Relatório DEPOIS: o mutante da fronteira foi morto

Rodando `npm run test:mutation` novamente, o mutante de `shipping.ts:13`
**desapareceu** da lista de sobreviventes — foi **morto** pelo novo teste. Os
sobreviventes restantes são outros (não relacionados à fronteira do frete):

```
[Survived] EqualityOperator
packages/checkout/src/coupon.ts:36:10
-     return total < 0 ? 0 : total;
+     return total <= 0 ? 0 : total;

[Survived] MethodExpression
packages/checkout/src/shipping.ts:17:33
-     const primeiroDigito = Number(cep.trim().charAt(0));
+     const primeiroDigito = Number(cep.charAt(0));
```

Placar final (trecho real do clear-text):

```
-------------|--------|---------|----------|-----------|------------|----------|----------|
File         |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-------------|--------|---------|----------|-----------|------------|----------|----------|
All files    |  96.30 |   96.30 |       52 |         0 |          2 |        0 |        0 |
 cart.ts     | 100.00 |  100.00 |        4 |         0 |          0 |        0 |        0 |
 coupon.ts   |  96.55 |   96.55 |       28 |         0 |          1 |        0 |        0 |
 shipping.ts |  95.24 |   95.24 |       20 |         0 |          1 |        0 |        0 |
-------------|--------|---------|----------|-----------|------------|----------|----------|
```

| Métrica            | Antes  | Depois |
|--------------------|--------|--------|
| Score total        | 94.44% | 96.30% |
| Score `shipping.ts`| 90.48% | 95.24% |
| Mutantes mortos    | 51     | 52     |
| Sobreviventes      | 3      | 2      |

O **mutation score subiu** (94.44% → 96.30%) e, mais importante que o número, um
**bug de fronteira real** foi encontrado e corrigido — algo que a cobertura de
código, mesmo alta, jamais teria apontado.

> Os dois sobreviventes que restam são convites para o próximo ciclo: escrever
> um teste que distinga `< 0` de `<= 0` no piso do cupom fixo (subtotal igual ao
> valor do cupom) e um teste que force o `trim()` do CEP a importar. O
> mutation testing é iterativo: cada sobrevivente é uma pergunta "e se isto
> estivesse errado?" ainda sem resposta na suíte.

## Property-based testing (complemento)

No mesmo módulo, em
[`packages/checkout/test/property/precos.property.ts`](../../packages/checkout/test/property/precos.property.ts),
declaramos **invariantes** verificadas pelo `fast-check` sobre centenas de
entradas aleatórias, reforçando o núcleo de preços por outra frente:

- cupom **percentual** (0..100) sem mínimo: resultado sempre em `[0, subtotal]`;
- cupom **fixo** (≥ 0) sem mínimo: resultado sempre `>= 0` e `<= subtotal`
  (o piso em 0 nunca é violado);
- `calcularSubtotal`: sempre `>= 0`, e **aditivo** —
  `subtotal(A ++ B) == subtotal(A) + subtotal(B)` (com tolerância de ponto
  flutuante).

Rode com `npm run test:property`.
