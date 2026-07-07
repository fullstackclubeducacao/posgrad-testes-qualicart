# QualiCart — Módulo 3: Qualidade Contínua e Observabilidade

O **QualiCart** é o projeto-fio-condutor da disciplina *Estratégias de Testes e Qualidade de Software*. Começou, no Módulo 1, como um mini e-commerce de checkout (carrinho, cupons e frete) em **Node.js + TypeScript** executado pelo **interpretador TypeScript nativo do Node** — sem build, sem transpilação, sem `dist/`. No Módulo 2, o monólito virou **dois serviços** (catálogo + checkout) e a estratégia de testes acompanhou a distribuição (contratos, integração real, property/mutation, E2E, carga, chaos).

Você está na branch **`modulo-3`** (marco `m3-final`). Aqui a qualidade **sai do pipeline e entra na produção**: até agora ela vivia *antes* do deploy (shift-left — testes que aprovam ou reprovam um PR); neste módulo ela passa a viver *também depois*, no sistema em execução, com usuários reais (shift-right). Segurança vira gate contínuo (SAST/SCA), os *thresholds* de carga viram **SLOs com error budget**, a entrega vira **progressiva** (feature flags/canary), o sistema fica **observável** (OpenTelemetry) e a camada visível ganha seus próprios testes (**acessibilidade** + **visual regression**). Continua tudo em **TypeScript nativo do Node** (sem build). Este README descreve o estado **cumulativo** — tudo o que os Módulos 1 e 2 estabeleceram **mais** o que o Módulo 3 acrescentou.

---

## Mapa de branches

O repositório é **evolutivo**: cada módulo vive em sua própria branch, para você acompanhar a maturação da qualidade comparando estados com `git diff`.

| Branch | O que representa |
| --- | --- |
| `main` / `inicio` | **Starter** entregue ao aluno: monólito de checkout, testes fracos, *code smells*, sem CI. |
| `modulo-1` | Fundação de qualidade: TDD, BDD, CI com *gates*, cobertura e diagnóstico. Tag: `m1-final`. |
| `modulo-2` | Split em catálogo + checkout e testes do distribuído: Pact, testcontainers, property/mutation, Playwright, k6, chaos, CI evoluído. Tag: `m2-final`. |
| **`modulo-3`** | **Esta branch.** Qualidade contínua e observabilidade: segurança no pipeline (SAST/SCA), SLO + *error budget*, *feature flags*/canary, OpenTelemetry, acessibilidade e *visual regression*. Tag: `m3-final`. |
| `modulo-4` *(futuro)* | Assistente/agente de IA, *golden dataset*, evals (Promptfoo), defesas de runtime, *red teaming* e testes A/B — reaproveitando flags, observabilidade e error budget deste módulo. |

Para navegar entre os estágios:

```bash
git checkout modulo-3              # entra nesta branch
git diff modulo-2 modulo-3         # vê exatamente o que o Módulo 3 acrescentou
git diff modulo-2 modulo-3 --stat  # resumo por arquivo (segurança, SLO, flags, OTel, a11y/visual)
git log --oneline                  # lê a história de commits
```

---

## Arquitetura

A topologia dos **dois serviços** do Módulo 2 permanece — o checkout resolve cada preço no catálogo por HTTP e persiste o pedido. O que o Módulo 3 acrescenta ao desenho é **transversal**: uma camada de **instrumentação OpenTelemetry** que atravessa os dois processos (um mesmo `traceId` propagado via header W3C `traceparent`) e uma **feature flag** no checkout que escolhe, em tempo de execução, entre resolução de preços sequencial (atual) e resiliente (paralela + timeout + retry + fallback).

```text
                 POST /checkout
   navegador ─────────────────────▶  ┌──────────────────────────────────┐
   / curl                            │  CHECKOUT  (porta 3000)           │
                                     │  ── instrumentação OTel (--import)│
                                     │                                   │
                                     │  server.ts  [span raiz SERVER]    │
                                     │    └ checkout-service.ts          │   GET /produtos/:sku      ┌───────────────────────────┐
                                     │        ├ flags.ts ── checkoutResiliente?                       │ CATÁLOGO (porta 3001)     │
                                     │        │     OFF → sequencial     │   traceparent (W3C)       │ ── instrumentação OTel    │
                                     │        │     ON  → Promise.all +  │  ────────────────────────▶│  server.ts [span SERVER]  │
                                     │        │           timeout+retry  │   { sku, nome, preco }    │    └ products.ts          │
                                     │        ├ catalog-client.ts ───────┼──[span CLIENT + inject]──▶│  (preços em memória)      │
                                     │        │   (lógica pura de preços)│◀──────────────────────────│  + ganchos de chaos (env) │
                                     │        └ pedido-repository         │                           └───────────────────────────┘
                                     │              │                    │
                                     └──────────────┼────────────────────┘
                                                    │ salvar(pedido)
                                                    ▼
                          ┌─────────────────────────────────────────────┐
                          │  PedidoRepositoryMemoria  (default, sem I/O)  │
                          │  PedidoRepositoryPostgres (pg → Postgres)     │
                          └─────────────────────────────────────────────┘

         ╰─ um único trace distribuído: POST /checkout ─▶ 2× GET /produtos/:sku (checkout CLIENT ▶ catálogo SERVER) ─╯
```

**Camadas do checkout** (`packages/checkout/src/`):

- **`instrumentation.ts`** *(novo)* — sobe o `NodeSDK` do OTel (`service.name = qualicart-checkout`), registra o propagador W3C e os exporters de span/métrica. Carregado **antes** do app via `node --import`.
- **`server.ts`** — servidor HTTP nativo (`node:http`); serve a UI (`/`) e `POST /checkout`. Agora abre o **span raiz** `POST /checkout` (`SpanKind.SERVER`) e registra as métricas de checkout. Traduz erros de domínio em status (`422` produto inexistente, `502`/`503` falha de catálogo).
- **`checkout-service.ts`** — orquestra I/O. Consulta `flags.ts` (`isEnabled('checkoutResiliente', …)`) e escolhe o braço de resolução de preços; deriva a `chaveDeRollout` do cliente para o rollout *sticky*.
- **`flags.ts`** *(novo)* — módulo de feature flags: `isEnabled`/`recarregarFlags`, defaults no código + override por `FLAGS` (JSON), rollout percentual **determinístico e sticky** (hash FNV-1a da chave).
- **`catalog-client.ts`** — consumidor do contrato HTTP; abre span `GET /produtos/:sku` (`SpanKind.CLIENT`) e injeta o `traceparent` no `fetch`. No braço resiliente ganha `AbortController` (timeout 800 ms) + 1 retry.
- **`checkout.ts`, `cart.ts`, `coupon.ts`, `shipping.ts`** — núcleo puro de preços herdado do M1 (sem I/O).
- **`pedido-repository.ts`** / **`pedido-repository-postgres.ts`** — interface + impl. em memória (default) e impl. Postgres (`pg`, com `schema.sql`).

**Serviço de catálogo** (`packages/catalog/src/`): `instrumentation.ts` *(novo)* espelha a instrumentação (`service.name = qualicart-catalog`); `server.ts` extrai o `traceparent` do request e abre um span **filho** do cliente, com a latência de *chaos* **dentro** do span; `products.ts` é o catálogo em memória, com ganchos `CHAOS_LATENCY_MS`/`CHAOS_FAIL_RATE` (inertes no normal).

---

## O que o Módulo 3 acrescentou

Sobre a arquitetura distribuída do Módulo 2, esta branch entrega **seis** itens — todos implementados e verdes:

1. **Segurança no pipeline (SAST + SCA).** `eslint-plugin-security` (**SAST**, analisa o *nosso* código) carregado no lint pelo flat config (`eslint.config.js`) + `npm audit --audit-level=high` (**SCA**, analisa as *dependências*) — `npm run audit`. Ambos viram **jobs no CI**. Achado real de SAST (`detect-non-literal-fs-filename` num `readFile` de teste) analisado e **classificado como falso positivo seguro** (caminho fixo derivado de `import.meta.url`, sem entrada de usuário). `npm audit` = **0 high/critical, 7 moderate** (todas transitivas de *devDependencies* — stryker/cucumber — sem presença no runtime de produção; `pg` está limpo). As regras de segurança ficam como `warn` de propósito (sinalizam sem quebrar por falso positivo). Ver [`docs/modulo-3/seguranca-pipeline.md`](docs/modulo-3/seguranca-pipeline.md).

2. **SLO + error budget + carga que reprova ao violar o SLO.** `load/checkout-slo.js` — `npm run slo:load`. Os **thresholds do k6 passam a SER os SLOs** do `POST /checkout`: disponibilidade **≥ 99,5%**, **p99 < 400 ms**, **p95 < 250 ms** (janela de 30 dias). Com catálogo saudável **passa** (exit 0, p99 ≈ 5,87 ms); sob chaos (`CHAOS_LATENCY_MS=500`, resolução sequencial) o p99 vai a **1,51 s** e o teste **reprova** (exit **99**) — mesmo com disponibilidade 100%, pois o que reprova é *"funciona dentro do SLO?"*, não *"funciona?"*. O **error budget** (0,5%) é calculado em números concretos (~5.000 checkouts ou ~3h36/mês num volume hipotético de 1M/mês) e ligado a burn rate/canary/DORA. Ver [`docs/modulo-3/slo-error-budget.md`](docs/modulo-3/slo-error-budget.md).

3. **Feature flag + canary (progressive delivery).** `packages/checkout/src/flags.ts` implementa rollout percentual **determinístico e sticky** (mesmo usuário → sempre o mesmo braço). A flag `checkoutResiliente` **desacopla deploy de release**: OFF = comportamento atual (resolução sequencial); ON = resolução **paralela** (`Promise.all`) + **timeout** (800 ms) + **retry** (1×, backoff 100 ms) + **falha fechada** (`CatalogoIndisponivelError` → HTTP 503, nunca preço inventado). É a resposta ao achado do chaos do M2 — medido em `chaos/comparativo-flag.mjs`: latência **606,5 → 304,6 ms** (~50% pela paralelização) e taxa de erro **46,7% → 10,0%** (retry recupera transitórias). Inclui plano de canary 1% → 5% → 25% → 50% → 100% com critério objetivo de avançar/reverter e ciclo de vida da flag. Ver [`docs/modulo-3/feature-flags-canary.md`](docs/modulo-3/feature-flags-canary.md).

4. **Observabilidade com OpenTelemetry.** `instrumentation.ts` nos **dois** serviços, carregados via `node --import` (antes do app). Traces distribuídos com **propagação W3C manual** — a auto-instrumentação de `node:http` **não engancha de forma confiável** sob ESM nativo do Node 26 (*type stripping*, sem build), gerando traces-raiz separados; por isso spans manuais explícitos (`startActiveSpan` + `propagation.inject`/`extract`), que são determinísticos. Um trace real de checkout localiza o gargalo: `POST /checkout` de **628 ms** é essencialmente a soma das duas chamadas **sequenciais** ao catálogo (~304 ms cada, com chaos de 300 ms) — a lógica pura é sub-milissegundo. Duas métricas: contador `qualicart.checkouts.processados` + histograma `qualicart.checkout.duracao`. Por padrão exporta para o **console** (`ConsoleSpanExporter`); Jaeger é opcional via `OTEL_EXPORTER_OTLP_ENDPOINT`. Ver [`docs/modulo-3/observabilidade.md`](docs/modulo-3/observabilidade.md).

5. **Acessibilidade + regressão visual.** Gate **`@a11y`** (`e2e/a11y.spec.ts`, `@axe-core/playwright`) barra violações **sérias/críticas** de WCAG 2 A/AA — corrigiu um **contraste real**: texto de apoio `#c4c9ce` sobre branco tinha razão **1,66:1** (reprovado, esperado ≥ 4,5:1), trocado por `#6b7480` (> 4,5:1). Gate **`@visual`** (`e2e/visual.spec.ts`, `toHaveScreenshot`) compara pixel a pixel contra uma baseline versionada (`e2e/visual.spec.ts-snapshots/checkout-chromium-darwin.png`), com `maxDiffPixelRatio: 0.01`, animações desligadas e ciclo baseline → diff → aprovação humana. `npm run test:a11y` / `npm run test:visual`. Ver [`docs/modulo-3/a11y-visual.md`](docs/modulo-3/a11y-visual.md).

6. **CI evoluído.** O workflow `.github/workflows/ci.yml` ganhou os jobs de **`sast`** e **`sca`** (cedo, junto dos gates baratos) e o gate **E2E passou a rodar acessibilidade** (`@a11y`), **excluindo `@visual`** — as baselines visuais são por plataforma (versionamos as de darwin; falhariam no runner linux). Carga/SLO (k6), chaos e `@visual` **não** são gates por-PR: rodam sob demanda ou em ambiente consistente/serviço dedicado.

> **Honestidade dos números.** As latências *saudáveis* locais são baixíssimas porque os serviços rodam **em memória**, sem I/O de banco — o valor pedagógico está na **forma de ler** (por percentil, contra uma meta), não no absoluto. O OTel usa **console exporter** por padrão (Jaeger é opcional). As baselines de visual regression são **acopladas à plataforma** (SO + navegador). Todos os números acima são medidos, não estimados.

---

## Pipeline de CI (estado atual)

`.github/workflows/ci.yml` — gates ordenados do **mais barato ao mais caro** (fail fast). Os do Módulo 3 estão marcados:

| # | Job | O que faz | Depende de |
| --- | --- | --- | --- |
| 1 | **lint** | ESLint (estilo + estático) | — |
| 1b | **sast** *(M3)* | `npm run lint` com `eslint-plugin-security` (SAST, rótulo dedicado) | — |
| 1c | **sca** *(M3)* | `npm audit --audit-level=high` (SCA; barra high/critical) | — |
| 2 | **typecheck** | `tsc --noEmit` | — |
| 3 | **test** | unidade (`node --test`) + **gate de cobertura nativo** (lines 0.75 / functions 0.75 / branches 0.65) | lint, typecheck |
| 4 | **bdd** | Cucumber (comportamento de cupom) | test |
| 5 | **contract** | Pact (consumidor gera + provedor verifica) | test |
| 6 | **integration** | testcontainers (Postgres real) | test |
| 7 | **e2e** *(M3: + a11y)* | Playwright: jornada feliz **+ `@a11y`**, com `--grep-invert @visual` | test |

Os gates 1, 1b, 1c e 2 rodam em **paralelo**. **Sob demanda / fora do CI por-PR:** carga e **SLO** (`npm run slo:load`), **chaos** (`chaos/`) e o gate **`@visual`** (baseline por plataforma).

---

## Como rodar

Todos os scripts estão em `package.json`. Resultados abaixo já validados nesta branch.

### Pré-requisitos

- **Node.js >= 24** (recomendado **26**). Nenhuma ferramenta de build.
- **Docker** em execução — testes de integração (testcontainers sobe um Postgres descartável).
- **k6** (binário) — testes de carga e o **SLO-driven load**.
- **Chromium do Playwright** — E2E, a11y e visual: `npx playwright install chromium` (ou `--with-deps` no CI).

### Instalação e serviços (com observabilidade)

```bash
npm install                # pg em runtime; OTel, Pact, Playwright, axe, Stryker,
                           # fast-check, testcontainers, eslint-plugin-security em dev

npm run start:catalog      # CATÁLOGO em http://localhost:3001, OTel via --import (spans no console)
npm run start:checkout     # CHECKOUT  em http://localhost:3000, idem
```

### Suíte de testes (resultados reais)

```bash
npm test                   # unidade (node --test)               -> 45 verdes (inclui flags)
npm run test:coverage      # unidade + cobertura nativa
npm run test:property      # property-based (fast-check)
npm run test:contract      # Pact: consumidor + provedor
npm run test:integration   # Postgres em contêiner (Docker)
npm run test:e2e           # Playwright: jornada + a11y + visual  -> verdes localmente
npm run test:a11y          # gate de acessibilidade (axe-core)    -> verde
npm run test:visual        # regressão visual (baseline darwin)   -> verde
npm run test:mutation      # Stryker                              -> mutation score ~96%

npm run typecheck          # tsc --noEmit                         -> 0 erros
npm run lint               # ESLint (SAST incluso)                -> 0 erros (warnings de
                           #                                         complexidade e segurança, intencionais)
npm run bdd                # Cucumber
npm run audit              # npm audit --audit-level=high         -> 0 high/critical
```

### SLO-driven load (reprova ao violar o SLO)

```bash
# Suba catálogo (3401) e checkout (3400) e rode o k6 com thresholds = SLOs
CATALOG_PORT=3401 node packages/catalog/src/server.ts &
PORT=3400 CATALOG_URL=http://localhost:3401 node packages/checkout/src/server.ts &
npm run slo:load           # catálogo saudável -> PASSA (exit 0)

# Reinicie o catálogo degradado para violar o SLO de latência:
CATALOG_PORT=3401 CHAOS_LATENCY_MS=500 node packages/catalog/src/server.ts &
npm run slo:load           # p99 ~1,5s -> REPROVA (exit 99), o gate de release bloquearia
```

### Observabilidade: um trace que localiza o gargalo

```bash
# Catálogo com 300 ms de latência injetada + checkout, ambos com OTel via --import
CHAOS_LATENCY_MS=300 npm run start:catalog
npm run start:checkout

curl -X POST http://localhost:3000/checkout -H 'Content-Type: application/json' \
  -d '{"itens":[{"sku":"CAM-001","quantidade":2},{"sku":"CAN-001","quantidade":1}],"cep":"01001000","nomeCliente":"Ana","emailCliente":"ana@x.com"}'
# -> no console: um único traceId; spans do catálogo (~304 ms) dominam o POST /checkout (~628 ms).
#    Jaeger (opcional): OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 nos dois serviços.
```

### Feature flag: ativar o caminho resiliente

```bash
# Liga checkoutResiliente (paralelo + timeout + retry + fallback 503)
FLAGS='{"checkoutResiliente":{"enabled":true}}' npm run start:checkout
# Rollout parcial sticky (canary): {"checkoutResiliente":{"enabled":true,"rolloutPercent":25}}

# Comparativo real OFF vs. ON sob chaos (portas dedicadas, teardown garantido):
node chaos/comparativo-flag.mjs   # latência 606,5 -> 304,6 ms; erro 46,7% -> 10,0%
```

### Exemplo de requisição

Com os dois serviços no ar (itens carregam apenas `sku` + `quantidade`; o preço vem do catálogo):

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
├─ .github/workflows/ci.yml            # pipeline: lint, SAST, SCA, typecheck, test+cobertura,
│                                      # bdd, contract, integration, e2e+a11y (exclui @visual)
├─ docs/
│  ├─ modulo-1/                        # diagnóstico/estratégia e reflexão sobre cobertura
│  ├─ modulo-2/                        # contrato, mutação, e2e, carga, chaos
│  └─ modulo-3/
│     ├─ seguranca-pipeline.md          # SAST + SCA (DevSecOps): achado real e npm audit
│     ├─ slo-error-budget.md            # SLI/SLO/SLA, error budget, k6 threshold = SLO
│     ├─ feature-flags-canary.md        # flag checkoutResiliente + plano de canary
│     ├─ observabilidade.md             # OpenTelemetry: trace distribuído localiza o gargalo
│     └─ a11y-visual.md                 # axe-core (contraste real) + visual regression
├─ e2e/
│  ├─ checkout.spec.ts                 # jornada E2E (Playwright/chromium)
│  ├─ a11y.spec.ts                     # gate de acessibilidade @a11y (axe-core)
│  ├─ visual.spec.ts                   # regressão visual @visual (toHaveScreenshot)
│  └─ visual.spec.ts-snapshots/
│     └─ checkout-chromium-darwin.png  # baseline versionada (acoplada a SO+navegador)
├─ load/
│  ├─ checkout-carga.js                # carga k6 do M2 (ramp-up até 50 VUs)
│  └─ checkout-slo.js                  # SLO-driven: thresholds = SLOs (reprova ao violar)
├─ chaos/
│  ├─ experimento-catalogo.mjs / .sh   # experimento de chaos do M2 (intacto)
│  └─ comparativo-flag.mjs             # comparativo OFF vs. ON da flag sob chaos
├─ pacts/                              # contrato gerado pelo consumidor (Pact)
├─ features/                           # BDD em Gherkin (pt) + step definitions
├─ packages/
│  ├─ catalog/                         # SERVIÇO DE CATÁLOGO (preços, porta 3001)
│  │  └─ src/
│  │     ├─ produto.ts, products.ts     # tipo + catálogo em memória
│  │     ├─ server.ts                   # HTTP nativo + span filho (OTel) + ganchos de chaos
│  │     └─ instrumentation.ts          # NodeSDK OTel (service.name qualicart-catalog)
│  └─ checkout/                        # SERVIÇO DE CHECKOUT (porta 3000)
│     ├─ public/index.html             # UI (a11y corrigida + baseline visual)
│     ├─ src/
│     │  ├─ cart.ts, coupon.ts, shipping.ts, checkout.ts   # núcleo puro de preços
│     │  ├─ catalog-client.ts          # consumidor HTTP (Pact) + span CLIENT/timeout/retry
│     │  ├─ checkout-service.ts         # orquestra catálogo + flag + persistência
│     │  ├─ flags.ts                    # feature flags (rollout sticky)
│     │  ├─ instrumentation.ts          # NodeSDK OTel (service.name qualicart-checkout)
│     │  ├─ pedido-repository*.ts        # interface + memória + Postgres (pg)
│     │  └─ server.ts                   # HTTP do checkout + span raiz (OTel) + métricas
│     └─ test/
│        ├─ unit/                       # ... + flags.test.ts (on/off, rollout, stickiness)
│        ├─ contract/ · integration/ · property/
├─ eslint.config.js                    # flat config + eslint-plugin-security (SAST)
├─ playwright.config.ts                # e2e; reduced-motion; toHaveScreenshot maxDiffPixelRatio
├─ stryker.config.json · tsconfig.json · cucumber.mjs · package.json
```

---

## Próximo passo

O **Módulo 4** leva o QualiCart para o território da **IA**: um **assistente/agente** sobre o checkout, com **golden dataset**, **evals** automatizadas (Promptfoo), **defesas de runtime** (contra *prompt injection*, alucinação de preço, ações indevidas), **red teaming** adversarial e **testes A/B** de comportamento. O ponto-chave é que ele **reaproveita a infraestrutura construída aqui**: os **feature flags** *sticky* deste módulo viram o mecanismo de **A/B** (cada usuário consistentemente em A ou B); a **observabilidade (OTel)** vira o instrumento que mede o comportamento do modelo em produção; e o **error budget / SLO** vira o critério que governa quando promover ou reverter uma variante de IA. A qualidade contínua e observável deste módulo é, portanto, o **alicerce** sobre o qual a qualidade de IA é construída. Quando chegar lá, use `git diff modulo-3 modulo-4` para ver a evolução.
