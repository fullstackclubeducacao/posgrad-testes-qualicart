# Feature Flags e Canary Release no QualiCart

> Módulo 3 — Progressive Delivery / Shift-Right. Fecha o loop aberto no Módulo 2:
> o experimento de chaos mostrou que o checkout ficava **menos** confiável que a
> própria dependência quando o catálogo degradava. Aqui entregamos a correção
> **atrás de uma feature flag**, com um plano de canary para colocá-la em
> produção sem susto.

---

## 1. O que são feature flags (e por que importam)

Uma **feature flag** (ou _feature toggle_) é um interruptor em configuração que
decide, **em tempo de execução**, qual caminho de código roda — sem novo build e
sem novo deploy.

O ganho central é **desacoplar DEPLOY de RELEASE**:

- **Deploy** = colocar o binário/código no ambiente. Os _dois_ caminhos (antigo
  e novo) já vão juntos para produção.
- **Release** = tornar o comportamento novo visível para os usuários. Isso vira
  uma mudança de **configuração** — ligar a flag.

Consequências diretas nas métricas **DORA**:

- **Reversão em segundos**: se a versão nova piora as métricas, basta
  **desligar a flag** (uma variável de ambiente / config). Não há rollback de
  deploy, não há rebuild. Isso derruba o **MTTR** (tempo de recuperação) de
  minutos/horas para segundos.
- **Lead time / frequência de deploy**: como o código novo entra desligado, dá
  para integrar cedo e liberar quando quiser (canary), aumentando a frequência
  de deploy com baixo risco.

Feature flags são a base do **progressive delivery**: em vez do release "big
bang" (0% → 100% de uma vez), liberamos **gradualmente**, observando o
comportamento **em produção, com tráfego real** (isto é _shift-right_:
testar/observar à direita do pipeline, complementando os testes de shift-left).

---

## 2. A flag `checkoutResiliente`

Implementada em [`packages/checkout/src/flags.ts`](../../packages/checkout/src/flags.ts).

### 2.1 O módulo de flags

API pública:

```ts
type FlagConfig  = { enabled: boolean; rolloutPercent?: number };
type FlagContexto = { chave?: string };

isEnabled(flag: string, contexto?: FlagContexto): boolean
recarregarFlags(): void   // limpa o cache (usado em testes)
```

- **Fonte de configuração**: defaults no código + override via variável de
  ambiente `FLAGS` (JSON). Ex.:
  `FLAGS='{"checkoutResiliente":{"enabled":true,"rolloutPercent":25}}'`.
  JSON inválido é ignorado (fail-safe: cai nos defaults, nunca derruba o serviço).
- **Default**: `checkoutResiliente` nasce **desligada** — representa o
  comportamento **hoje em produção**. O canary vai ligá-la aos poucos.
- **Rollout percentual sticky**: quando há `rolloutPercent`, a decisão é
  **determinística por um hash da `chave`** do contexto
  (`FNV-1a(flag:chave) % 100 < rolloutPercent`). Isso garante **stickiness**: o
  **mesmo** usuário cai **sempre** no mesmo braço. Essencial para:
  - **canary** — a fração exposta é estável, não "pisca" a cada request;
  - o **A/B do Módulo 4** — cada usuário fica consistentemente em A ou B.
  No checkout a `chave` é derivada do cliente (`emailCliente`, senão `nomeCliente`,
  senão a composição dos SKUs) — ver `chaveDeRollout` em `checkout-service.ts`.

Regras de `isEnabled` (resumo):

| Situação | Resultado |
|---|---|
| flag desconhecida | `false` (fail-closed) |
| `enabled: false` | `false` |
| `enabled: true`, sem `rolloutPercent` | `true` (100%) |
| `rolloutPercent <= 0` | `false` |
| `rolloutPercent >= 100` | `true` |
| `rolloutPercent` parcial **com** `chave` | `hash(chave) % 100 < rolloutPercent` |
| `rolloutPercent` parcial **sem** `chave` | `false` (conservador — não expõe sem stickiness) |

Testes em [`test/unit/flags.test.ts`](../../packages/checkout/test/unit/flags.test.ts):
on/off, rollout 0%/100%, stickiness (mesma chave → mesma decisão em 100
avaliações) e distribuição (~30% sobre 10.000 chaves, tolerância ±3 pp).

### 2.2 O que a flag controla

A resolução de preços dos itens no `finalizarCheckout`
([`checkout-service.ts`](../../packages/checkout/src/checkout-service.ts)) tem
dois braços, com o **mesmo resultado no caminho feliz**:

| | **Flag OFF** (atual, produção) | **Flag ON** (resiliente, canary) |
|---|---|---|
| Resolução | **Sequencial** (`for` item a item) | **Paralela** (`Promise.all`) |
| Timeout por chamada | nenhum | `AbortController`, 800 ms |
| Retry | nenhum | 1 retry com backoff de 100 ms |
| Falha permanente (404) | propaga → HTTP 422 | propaga (sem retry) → HTTP 422 |
| Falha transitória (503/timeout/rede) | sobe genérico → HTTP 502 | após esgotar retry, `CatalogoIndisponivelError` → **HTTP 503** |

**Decisão arquitetural: falhar fechado.** Se, mesmo com timeout + retry, o
catálogo não responde um preço, **não inventamos preço** — lançamos
`CatalogoIndisponivelError`, traduzido pelo `server.ts` para **503**. O
trade-off: preferimos **recusar explicitamente** o pedido (o cliente reflete a
indisponibilidade real) a **cobrar um valor errado** (risco financeiro/confiança).
Um fallback de preço a partir de cache seria válido, mas exigiria política de
validade/consistência — ficou fora de escopo por ora.

Manter o braço OFF **idêntico** ao comportamento atual é intencional: o diff
fica limpo e o canary tem os **dois braços reais** para comparar.

---

## 3. Números reais da melhoria (sob chaos)

Medido com [`chaos/comparativo-flag.mjs`](../../chaos/comparativo-flag.mjs)
(script próprio; o experimento committed do Módulo 2 não foi alterado). Portas
dedicadas 3300/3301, teardown garantido, catálogo degradado idêntico nos dois
braços.

### Benefício da **paralelização** (só latência, sem 503 — 2 itens, +300 ms/chamada)

| Braço | Latência média |
|---|---|
| **OFF** (sequencial) | **606,5 ms** |
| **ON** (paralelo) | **304,6 ms** |

→ **~50% de redução** de latência — os dois `GET /produtos/:sku` de 300 ms
deixam de somar (600 ms) e passam a rodar concorrentes (~300 ms). Confirma o
gargalo que a instrumentação OTel do Módulo 3 apontou (chamadas sequenciais).

### Benefício de **timeout + retry + fallback** (catálogo com 30% de 503, +200 ms)

| Braço | Taxa de erro | Latência média | Status HTTP |
|---|---|---|---|
| **OFF** | **46,7%** | 349,5 ms | 200 e **502** |
| **ON** | **10,0%** | 346,3 ms | 200 e **503** |

→ **Taxa de erro cai de 46,7% para 10,0%** com latência praticamente igual: o
retry recupera a maioria das falhas transitórias, e o resíduo falha **fechado e
explícito** (503, não 502 genérico). Sob falha severa (50% de 503) a taxa de
erro também melhora (ex.: 87,5% → 70,0%), mas a maior fatia do ganho vem da
paralelização + retry; medições variam com a aleatoriedade do chaos.

**Leitura para o canary:** a melhora não é hipótese, é observável. Nas primeiras
etapas do rollout esperamos ver **p99 do checkout cair** (paralelização) e a
**taxa de 5xx cair** (retry), sem novos modos de falha além do 503 esperado.

---

## 4. Plano de canary para `checkoutResiliente`

Objetivo: levar a flag de 0% → 100% **em produção**, com tráfego real,
observando as métricas do Módulo 3 (OTel) a cada passo e com critério objetivo
de avançar ou reverter.

### Passos e percentuais

| Etapa | `rolloutPercent` | Duração mínima de observação |
|---|---|---|
| 0. Dark launch | 0% (código deployado, flag off) | — |
| 1. Canary inicial | **1%** | ~30 min / 1 pico de tráfego |
| 2. | **5%** | ~1 h |
| 3. | **25%** | algumas horas |
| 4. | **50%** | ~1 dia |
| 5. GA | **100%** | estabiliza e vira default |

Como o rollout é **sticky por `chave`**, a fração exposta é sempre o **mesmo**
conjunto de clientes crescendo — comparação canary vs. controle é justa.

### Métricas observadas em cada passo (via OTel — Módulo 3)

Comparar sempre o **braço canary (flag ON)** contra o **controle (flag OFF)** no
mesmo intervalo. Segmentar por `checkout.resiliente` / resultado do span:

1. **Taxa de erro** (5xx do checkout): `qualicart.checkouts.processados`
   com `resultado=erro`. **Esperado: cair.** O 503 (falha fechada) é aceitável e
   deve ser distinguido do 502 (falha não tratada, que deve sumir).
2. **Latência p99 / p95** (`qualicart.checkout.duracao`). **Esperado: p99 cair**
   pela paralelização. Vigiar caudas por causa do retry.
3. **Consumo de error budget** — quanto do orçamento de erros do SLO o canary
   está queimando. É o **critério de parada** mais objetivo.
4. **Saúde da dependência**: volume de chamadas ao catálogo (o retry ~dobra
   chamadas no pior caso) — não pode saturar o catálogo.

### Critério objetivo — avançar vs. reverter

**Avança para o próximo percentual** quando, no braço canary vs. controle:

- taxa de erro **≤** controle (idealmente menor);
- p99 **não** piora além de +10%;
- **nenhum** 502 novo (falha não tratada) e **zero** erros de correção
  (total/desconto do pedido idênticos ao controle no caminho feliz);
- **error budget** dentro do previsto para a janela.

**Reverte imediatamente** (flag → `enabled:false`, **segundos**) se qualquer um:

- taxa de erro do canary **>** controle de forma sustentada;
- p99 do canary **> +10%** do controle;
- surgir **502** (regressão) ou **divergência de valores** no pedido;
- **error budget** queimando acima do ritmo do passo.

A reversão é **um toggle de config**, não um rollback de deploy — é isto que
torna o canary seguro (MTTR em segundos).

---

## 5. Ciclo de vida da flag (flags têm validade)

Feature flag **não é permanente** — flag esquecida vira **dívida técnica**:
código morto, dois caminhos para testar/manter, `if`s que confundem.

Ciclo de vida de `checkoutResiliente`:

1. **Nasce OFF** (default), código dos dois braços em produção.
2. **Canary** 1% → 100% conforme a Seção 4.
3. **Estabilização** em 100% por um período de observação.
4. **Aposentadoria (cleanup)**: remover o braço OFF (sequencial), tornar o
   comportamento resiliente o **único** caminho e apagar a flag do código e da
   config. Registrar uma **data de validade** já na criação da flag evita que ela
   apodreça no código.

Enquanto a flag existe, ela é um **flag de release** (temporário) — diferente de
um _flag de operação_ (kill-switch de longa duração) ou de _experimentação_
(o A/B do Módulo 4, que reaproveita a mesma mecânica sticky).

---

## 6. Conexão com progressive delivery / shift-right

- **Shift-left** (Módulos 1–2): testes de unidade, contrato, propriedade e chaos
  **antes** de produção. Necessário, mas não observa o **tráfego real**.
- **Shift-right** (este módulo): observar/validar **em produção**, com usuários
  reais, protegido por flags e canary, guiado pela **observabilidade (OTel)** do
  Módulo 3. O canary é um experimento controlado com **blast radius** de 1% → …
  → 100% e botão de reversão em segundos.

Feature flags são o mecanismo que torna esse experimento **seguro**: entregamos
a correção da resiliência (paralelização + timeout + retry + falha fechada) para
produção de forma incremental, medindo o ganho real (Seção 3) a cada passo, e
podendo desfazer instantaneamente se algo fugir do previsto.
