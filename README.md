# QualiCart — Módulo 2: Testes em Arquiteturas Distribuídas

O **QualiCart** é o projeto-fio-condutor da disciplina *Estratégias de Testes e Qualidade de Software*. Começou, no Módulo 1, como um mini e-commerce de checkout (carrinho, cupons e frete) escrito em **Node.js + TypeScript** e executado pelo **interpretador TypeScript nativo do Node** — sem build, sem transpilação, sem pasta `dist/`.

Você está na branch **`modulo-2`** (marco `m2-final`). Aqui o monólito de checkout foi **dividido em dois serviços** — **catálogo** (preços) e **checkout** (que passa a consumir o catálogo por HTTP) — e a **estratégia de testes acompanhou a distribuição**: contratos com Pact, integração com banco real via testcontainers, property-based e mutation testing sobre o núcleo de preços, uma jornada E2E com Playwright, carga com k6 e um experimento de chaos. Este README descreve o estado **cumulativo**: tudo o que o Módulo 1 estabeleceu **mais** o que o Módulo 2 acrescentou.

---

## Mapa de branches

O repositório é **evolutivo**: cada módulo vive em sua própria branch, para você acompanhar a maturação da qualidade comparando estados com `git diff`.

| Branch | O que representa |
| --- | --- |
| `main` / `inicio` | **Starter** entregue ao aluno: monólito de checkout, testes fracos, *code smells*, sem CI. |
| `modulo-1` | Fundação de qualidade: TDD, BDD, CI com *gates*, cobertura e diagnóstico. Tag: `m1-final`. |
| **`modulo-2`** | **Esta branch.** Split em catálogo + checkout e testes do distribuído: Pact, testcontainers, property/mutation, Playwright, k6, chaos, CI evoluído. Tag: `m2-final`. |
| `modulo-3` *(futuro)* | Segurança no pipeline (SAST/SCA), SLO e *error budget*, *feature flags*/canary, OpenTelemetry, acessibilidade, *visual regression*. |
| `modulo-4` *(futuro)* | Assistente de IA, *golden dataset*, evals, defesas de runtime, *red teaming*, testes A/B. |

Para navegar entre os estágios:

```bash
git checkout modulo-2              # entra nesta branch
git diff modulo-1 modulo-2         # vê exatamente o que o Módulo 2 acrescentou
git diff modulo-1 modulo-2 --stat  # resumo por arquivo (split + novas suítes)
git log --oneline                  # lê a história de commits
```

---

## Arquitetura

O que era um único processo virou **dois serviços** que se comunicam por HTTP. O checkout deixou de conhecer os preços: ele os **resolve no catálogo** a cada item e persiste o pedido num repositório.

```text
                 POST /checkout
   navegador ─────────────────────▶  ┌───────────────────────────┐
   / curl                            │  CHECKOUT  (porta 3000)    │
                                     │                            │
                                     │  server.ts                 │
                                     │    └ checkout-service.ts   │   GET /produtos/:sku    ┌──────────────────────┐
                                     │        ├ catalog-client.ts ──────────────────────────▶│ CATÁLOGO (porta 3001)│
                                     │        │   (HTTP, CATALOG_URL)   { sku, nome, preco } │  server.ts           │
                                     │        ├ checkout.ts       │◀──────────────────────────│    └ products.ts     │
                                     │        │   (lógica pura)   │                          │  (preços em memória) │
                                     │        └ pedido-repository │                          └──────────────────────┘
                                     │              │             │
                                     └──────────────┼─────────────┘
                                                    │ salvar(pedido)
                                                    ▼
                          ┌─────────────────────────────────────────────┐
                          │  PedidoRepositoryMemoria  (default, sem I/O)  │
                          │  PedidoRepositoryPostgres (pg → Postgres)     │
                          └─────────────────────────────────────────────┘
```

**Camadas do checkout** (`packages/checkout/src/`):

- **`server.ts`** — servidor HTTP nativo (`node:http`). Serve a UI (`/`) e o endpoint `POST /checkout`. Traduz erros de domínio em status (`422` para produto inexistente, `502` para falha ao consultar o catálogo).
- **`checkout-service.ts`** — orquestra I/O: para cada item busca o preço no catálogo, chama a lógica pura `processarCheckout` e persiste via `PedidoRepository` injetado. O cliente do catálogo é injetável, o que permite testes sem rede.
- **`catalog-client.ts`** — o **consumidor** do contrato HTTP. Faz `GET /produtos/:sku` contra `CATALOG_URL` (default `http://localhost:3001`) e lança `ProdutoNaoEncontradoError` no `404`. Espera exatamente `{ sku, nome, preco }`.
- **`checkout.ts`, `cart.ts`, `coupon.ts`, `shipping.ts`** — o núcleo puro de preços herdado do Módulo 1 (subtotal, cupom, frete, total), sem I/O.
- **`pedido-repository.ts`** — a interface `PedidoRepository` e a implementação `PedidoRepositoryMemoria` (default, roda sem banco). **`pedido-repository-postgres.ts`** — a implementação real com `pg`; `schema.sql` traz a DDL da tabela `pedidos`.

**Serviço de catálogo** (`packages/catalog/src/`): `server.ts` expõe `/health`, `/produtos` e `/produtos/:sku` a partir de um catálogo em memória (`products.ts`). Traz **ganchos de injeção de falha** por variável de ambiente (`CHAOS_LATENCY_MS`, `CHAOS_FAIL_RATE`) usados no experimento de chaos — inertes no funcionamento normal.

---

## O que o Módulo 2 acrescentou

Sobre a fundação do Módulo 1, esta branch entrega nove itens — **todos implementados e verdes**:

1. **Split em dois serviços.** `catalog` (preços, porta **3001**) e `checkout` (porta **3000**), que consome o catálogo por HTTP via `catalog-client.ts`. Suba os dois com `npm run start:catalog` e `npm run start:checkout`.

2. **Contract testing com Pact** — `npm run test:contract`. O **consumidor** (checkout) roda o cliente HTTP real contra um mock e grava o contrato em `pacts/qualicart-checkout-qualicart-catalog.json`; o **provedor** (catálogo) verifica esse contrato subindo o serviço real. Usa *matchers* de tipo (importa a forma, não o dado). A quebra deliberada (renomear `preco`→`precoUnitario`) e o diagnóstico do Pact estão em [`docs/modulo-2/contract-testing.md`](docs/modulo-2/contract-testing.md). Testes: `packages/checkout/test/contract/catalog.consumer.test.ts` e `packages/catalog/test/contract/catalog.provider.test.ts`.

3. **Integração com testcontainers** — `npm run test:integration`. `PedidoRepositoryPostgres` é exercitado contra um **Postgres REAL em contêiner** (sem mock), com a migração de `schema.sql`. Teste: `packages/checkout/test/integration/pedido-repository.integration.ts`.

4. **Property-based testing com fast-check** — `npm run test:property`. Verifica **invariantes** do núcleo de preços sobre centenas de entradas aleatórias (cupom percentual sempre em `[0, subtotal]`; cupom fixo nunca fura o piso 0; subtotal `>= 0` e aditivo). Teste: `packages/checkout/test/property/precos.property.ts`.

5. **Mutation testing com Stryker** — `npm run test:mutation`. Revelou um **mutante sobrevivente** na fronteira do frete (`>` vs. `>=` em `shipping.ts`) que denunciava um **bug real**: em subtotal exatamente R$200 o cliente pagava frete quando a regra manda ser grátis. Adicionamos o teste de fronteira, trocamos `>`→`>=` e o mutante foi morto; o *mutation score* subiu de ~94% para **~96%**. Config em `stryker.config.json`, relatório HTML em `reports/mutation/index.html`, narrativa completa em [`docs/modulo-2/mutation-testing.md`](docs/modulo-2/mutation-testing.md).

6. **Jornada E2E com Playwright** — `npm run test:e2e`. **Uma única** jornada (checkout feliz) no chromium, como "tempero" no topo do troféu: o `webServer` sobe catálogo + checkout automaticamente, preenche o formulário como um usuário e verifica o total na tela. Teste: `e2e/checkout.spec.ts`; config em `playwright.config.ts`. Ver [`docs/modulo-2/e2e-playwright.md`](docs/modulo-2/e2e-playwright.md).

7. **Teste de carga com k6** — `load/checkout-carga.js`. *Ramp-up* até 50 VUs com metas por **percentil** (`p95<500ms`, `p99<800ms`, erro `<1%`). O valor pedagógico é ler a **cauda** por percentil, não a média. Ver [`docs/modulo-2/carga-k6.md`](docs/modulo-2/carga-k6.md).

8. **Experimento de chaos** — `chaos/experimento-catalogo.mjs` (wrapper `.sh`). Injeta latência + erros 503 no catálogo e mede o checkout contra um baseline. Revelou a **ausência de timeout/retry/fallback**: com falha composta entre itens, a taxa de erro do checkout subiu a **70%** e a latência a ~485 ms. Ver [`docs/modulo-2/chaos-experimento.md`](docs/modulo-2/chaos-experimento.md).

9. **CI evoluído.** O workflow `.github/workflows/ci.yml` ganhou **gates do distribuído** após a unidade: `contract`, `integration` (Postgres em contêiner no runner) e `e2e` (Playwright). Carga e chaos **não** são gates por-PR — rodam sob demanda.

---

## Matriz de testes

Cada camada responde a uma pergunta diferente e tem um **escopo** e um **diagnóstico** próprios. Quanto mais alto no troféu, menos testes e mais valor por teste.

| Tipo | O que cobre | Ferramenta | Comando | O que NÃO cobre |
| --- | --- | --- | --- | --- |
| **Estático** | Tipos e problemas estáticos; base "de graça" | `tsc --noEmit`, ESLint | `npm run typecheck`, `npm run lint` | Comportamento em runtime |
| **Unidade** | Lógica pura de preços (cart/cupom/frete/checkout) em todos os ramos | `node --test` | `npm test` | Costuras entre serviços, I/O real |
| **Property** | Invariantes do núcleo de preços sob entradas aleatórias | fast-check | `npm run test:property` | Casos nomeados específicos, integração |
| **Contrato** | A costura HTTP checkout↔catálogo (forma de `/produtos/:sku`) | Pact | `npm run test:contract` | Correção do dado, performance, segurança |
| **Integração** | `PedidoRepositoryPostgres` contra Postgres real | testcontainers | `npm run test:integration` | UI, jornada ponta a ponta |
| **E2E** | A jornada de checkout feliz no navegador, tudo conectado | Playwright | `npm run test:e2e` | Casos de borda (papel das camadas de baixo) |
| **BDD** | O comportamento de cupom em linguagem de negócio | Cucumber | `npm run bdd` | Detalhes técnicos internos |
| **Mutação** | A **qualidade** da suíte de unidade (mata mutantes?) | Stryker | `npm run test:mutation` | É meta-teste; não valida o sistema em runtime |
| **Carga** | Latência do `/checkout` sob pressão, por percentil | k6 | `k6 run load/checkout-carga.js` | Correção funcional; roda sob demanda |
| **Chaos** | Resiliência do checkout quando o catálogo degrada | script Node | `./chaos/experimento-catalogo.sh` | Correção funcional; roda sob demanda |

Leitura didática: a **base estática + unidade + property** são baratas e apontam a linha exata; **contrato + integração** são o corpo do troféu (melhor custo × confiança nas costuras); o **E2E** é o tempero no topo (caro, frágil, diagnóstico ruim, reservado à jornada crítica). **Mutação** mede a suíte, não o sistema. **Carga e chaos** são *experimentos* de diagnóstico, não *gates* — eles revelam propriedades (cauda de latência, fragilidade sob falha), não aprovam/reprovam um PR.

---

## Como rodar

Todos os scripts estão em `package.json`. Resultados abaixo já validados nesta branch.

### Pré-requisitos

- **Node.js >= 24** (recomendado **26**). Nenhuma ferramenta de build.
- **Docker** em execução — para os testes de integração (testcontainers sobe um Postgres descartável).
- **k6** (binário) — apenas para o teste de carga.
- **Chromium do Playwright** — para o E2E: `npx playwright install chromium` (ou `--with-deps` no CI).

### Instalação e serviços

```bash
npm install                # instala dependências (pg em runtime; Pact, Playwright,
                           # Stryker, fast-check, testcontainers em dev)

npm run start:catalog      # sobe o CATÁLOGO em http://localhost:3001 (CATALOG_PORT)
npm run start:checkout     # sobe o CHECKOUT em http://localhost:3000 (PORT)
                           # o checkout usa CATALOG_URL (default http://localhost:3001)
```

### Suíte de testes (resultados reais)

```bash
npm test                   # unidade (node --test)            -> 30 verdes
npm run test:coverage      # unidade + cobertura nativa
npm run test:property      # property-based (fast-check)      -> 4 verdes
npm run test:contract      # Pact: consumidor + provedor      -> 3 verdes
npm run test:integration   # Postgres em contêiner (~17s)     -> 3 verdes
npm run test:e2e           # Playwright (chromium)            -> 1 jornada verde
npm run test:mutation      # Stryker                          -> mutation score ~96%

npm run typecheck          # tsc --noEmit                     -> 0 erros
npm run lint               # ESLint                           -> 0 erros
npm run bdd                # Cucumber                         -> 5 cenários
```

### Experimentos sob demanda (não são gates por-PR)

```bash
# Carga: suba catálogo (3101) e checkout (3100) e rode o k6
CATALOG_PORT=3101 node packages/catalog/src/server.ts &
PORT=3100 CATALOG_URL=http://localhost:3101 node packages/checkout/src/server.ts &
k6 run load/checkout-carga.js

# Chaos: sobe os dois serviços, injeta falha e faz teardown automático
./chaos/experimento-catalogo.sh
```

> **Sobre os números de carga/chaos:** localmente as latências são baixíssimas (p95 ~3 ms) porque o catálogo é **em memória**, sem I/O de banco. O valor não é o número absoluto e sim a **forma de ler** — por percentil, contra uma meta. Em ambiente parecido com produção os números subiriam; a leitura é idêntica.

### Exemplo de requisição

Com os dois serviços no ar, envie um checkout (agora os itens carregam apenas `sku` + `quantidade`; o preço vem do catálogo):

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{
    "itens": [
      { "sku": "CAM-001", "quantidade": 2 },
      { "sku": "CAN-001", "quantidade": 1 }
    ],
    "cupom": { "tipo": "percentual", "valor": 10 },
    "cep": "01000-000"
  }'
```

A resposta é o **pedido persistido** (com `id`, `itens`, `subtotal`, `desconto`, `frete`, `total`, `criadoEm`).

---

## Estrutura de pastas

```text
qualicart/
├─ .github/workflows/ci.yml            # pipeline: lint, typecheck, test+cobertura,
│                                      # bdd, contract, integration, e2e
├─ docs/
│  ├─ modulo-1/                        # diagnóstico/estratégia e reflexão sobre cobertura
│  └─ modulo-2/
│     ├─ contract-testing.md           # Pact: consumer-driven contracts + a quebra real
│     ├─ mutation-testing.md           # Stryker: mutante sobrevivente → bug de fronteira
│     ├─ e2e-playwright.md             # por que só a jornada feliz virou E2E
│     ├─ carga-k6.md                   # ramp-up e leitura por percentil
│     └─ chaos-experimento.md          # latência+erro no catálogo → 70% de erro
├─ e2e/checkout.spec.ts                # jornada E2E (Playwright/chromium)
├─ load/checkout-carga.js              # cenário de carga k6 (ramp-up até 50 VUs)
├─ chaos/
│  ├─ experimento-catalogo.mjs         # experimento de chaos (baseline vs. falha)
│  └─ experimento-catalogo.sh          # wrapper que sobe, mede e faz teardown
├─ pacts/
│  └─ qualicart-checkout-qualicart-catalog.json   # contrato gerado pelo consumidor
├─ features/                           # BDD em Gherkin (pt) + step definitions
├─ packages/
│  ├─ catalog/                         # SERVIÇO DE CATÁLOGO (preços, porta 3001)
│  │  ├─ src/
│  │  │  ├─ produto.ts                 # tipo Produto
│  │  │  ├─ products.ts                # catálogo em memória (fonte dos preços)
│  │  │  └─ server.ts                  # HTTP nativo + ganchos de chaos (env)
│  │  └─ test/
│  │     ├─ unit/products.test.ts
│  │     └─ contract/catalog.provider.test.ts   # verifica o pact (provedor)
│  └─ checkout/                        # SERVIÇO DE CHECKOUT (porta 3000)
│     ├─ public/index.html             # UI (com âncoras estáveis para o E2E)
│     ├─ src/
│     │  ├─ cart.ts, coupon.ts, shipping.ts, checkout.ts   # núcleo puro de preços
│     │  ├─ catalog-client.ts          # consumidor HTTP do catálogo (Pact)
│     │  ├─ checkout-service.ts         # orquestra catálogo + lógica + persistência
│     │  ├─ pedido-repository.ts        # interface + impl. em memória (default)
│     │  ├─ pedido-repository-postgres.ts  # impl. Postgres (pg)
│     │  └─ server.ts                   # servidor HTTP do checkout
│     └─ test/
│        ├─ unit/                       # cart, coupon, shipping, checkout, checkout-service
│        ├─ contract/catalog.consumer.test.ts   # gera o pact (consumidor)
│        ├─ integration/pedido-repository.integration.ts  # Postgres em contêiner
│        └─ property/precos.property.ts # invariantes com fast-check
├─ stryker.config.json                 # mutation testing (mutate: núcleo de preços)
├─ playwright.config.ts                # testDir e2e, chromium, webServer catálogo+checkout
├─ eslint.config.js · tsconfig.json · cucumber.mjs · package.json
```

---

## Próximo passo

O **Módulo 3** parte deste sistema distribuído para endurecer a operação: **segurança no pipeline** (SAST/SCA), **SLO e *error budget*** (formalizando os *thresholds* de carga em metas acordadas), **feature flags / canary** para entregas graduais, **OpenTelemetry** para observabilidade, **acessibilidade** e **visual regression** (o E2E já desabilita animações preparando o terreno). Muitas das lacunas apontadas aqui — o timeout/retry/fallback ausentes que o chaos revelou, o SLO que a carga só validou informalmente — viram trabalho de primeira classe lá. Quando chegar, use `git diff modulo-2 modulo-3` para ver a evolução.
