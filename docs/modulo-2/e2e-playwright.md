# E2E com Playwright — a jornada de checkout feliz

## O que fizemos

Escrevemos **um único teste ponta a ponta (E2E)** com o [Playwright](https://playwright.dev):
a **jornada feliz de checkout**. O teste abre a UI real servida pelo serviço de
checkout, preenche o formulário como um usuário de verdade (cupom + CEP), clica
em **Finalizar** e verifica o **total do pedido** exibido na tela.

Essa única jornada atravessa **todas as camadas do sistema**:

```
navegador (Playwright/chromium)
   │  GET / e POST /checkout
   ▼
serviço de checkout (porta 3000)
   │  lógica de negócio: subtotal, cupom, frete, total
   │  GET /produtos/:sku
   ▼
serviço de catálogo (porta 3001)  ← fonte dos preços
```

O `webServer` do Playwright sobe os **dois serviços** automaticamente antes dos
testes (catálogo em 3001, checkout em 3000 com `CATALOG_URL` apontando para o
catálogo) e os derruba ao final — sem processos órfãos, sem passos manuais.

### Arquivos

- `playwright.config.ts` — `testDir: e2e`, projeto chromium, `reporter: list`,
  animações desabilitadas (terreno pronto para _visual regression_ no Módulo 3)
  e `webServer` (array) subindo catálogo + checkout.
- `e2e/checkout.spec.ts` — a jornada feliz, com asserções sobre o total
  calculado (`R$ 158.73`) e o resumo detalhado.
- `packages/checkout/public/index.html` — pequeno ajuste de testabilidade:
  além do `<pre id="resultado">`, adicionamos um elemento estável
  `<strong id="resultado-total" data-status="...">` que expõe o total do pedido
  e um estado (`pendente` → `ok`/`erro`), mantendo HTML semântico e as `<label>`
  associadas aos inputs.

## Por que SOMENTE a jornada de checkout virou E2E?

Porque **E2E é caro e frágil** — e deve ser usado como **"tempero"**, não como
prato principal.

### 1. E2E é o tipo de teste mais caro que temos

- **Lento**: sobe processos reais, navegador real, faz I/O de rede real.
- **Frágil (_flaky_)**: qualquer mudança de layout, timing, porta ou
  disponibilidade de um serviço pode quebrá-lo por motivos que não são bugs de
  negócio.
- **Diagnóstico ruim**: quando falha, ele diz "a jornada quebrou", mas **não
  aponta a causa**. Você ainda precisa investigar em qual camada o problema
  está (UI? cálculo? cliente HTTP? catálogo?).

Multiplicar dezenas de cenários (cupom inválido, CEP de cada região, produto
inexistente, carrinho vazio, frete grátis VIP...) em E2E gera uma suíte lenta,
instável e cara de manter — o clássico **anti-padrão do "cone de sorvete"**
(muitos testes E2E, poucos unitários).

### 2. As "costuras" já estão cobertas por testes mais baratos

O valor de um E2E é provar que as peças **funcionam juntas de verdade**. Mas as
integrações individuais (as _costuras_ entre componentes) já são verificadas por
testes mais baratos e com **melhor diagnóstico**, criados nas outras atividades
do módulo:

- **Testes unitários** — a lógica pura de `cupom`, `frete`, `carrinho` e
  `processarCheckout` em todos os seus ramos (rápidos, determinísticos, apontam
  a linha exata do erro).
- **Testes de integração** — o `finalizarCheckout` consultando o catálogo e
  persistindo o pedido.
- **Testes de contrato (Pact)** — a costura HTTP entre checkout (consumidor) e
  catálogo (provedor): garantem que o formato de `/produtos/:sku` combina dos
  dois lados, **sem** precisar subir os dois serviços juntos.

Com essas camadas verdes, um **único** E2E basta para dar a confiança de que
"tudo conectado funciona" na jornada que mais importa para o negócio.

### 3. Escolhemos a jornada MAIS crítica de negócio

E2E se reserva para os **fluxos que geram receita ou que, se quebrarem, doem de
imediato**. Em um e-commerce, esse fluxo é o **checkout**: um cliente que
adiciona itens, aplica cupom, informa o CEP e finaliza o pedido. É a jornada que
justifica o custo de um teste caro.

## Conexão com o troféu de testes

O **Troféu de Testes** (Kent C. Dodds) reequilibra a antiga pirâmide e sugere
esta proporção:

```
        △   E2E            ← poucos, caros: só as jornadas críticas
      ▢▢▢   Integração     ← o corpo do troféu: melhor custo × confiança
    ◇◇◇◇◇   Unitário       ← rápidos, focados na lógica
   ▔▔▔▔▔▔   Estático       ← a base: tipos + lint, "de graça"
```

Nossa suíte segue exatamente esse formato:

- **Base estática**: `typecheck` (TypeScript) + `lint` (ESLint).
- **Unitários**: lógica pura de negócio.
- **Integração + contrato**: as costuras entre checkout e catálogo — é aqui que
  concentramos a maior parte da confiança, porque têm ótimo custo-benefício.
- **Topo (E2E)**: **uma** jornada de checkout feliz — o "tempero" que valida a
  experiência real do usuário de ponta a ponta.

> Regra prática: **quanto mais alto no troféu, menos testes e mais valor por
> teste**. E2E não serve para cobrir casos de borda (isso é papel das camadas de
> baixo); serve para provar que a jornada de negócio mais importante funciona de
> verdade, no navegador, com os serviços reais no ar.
