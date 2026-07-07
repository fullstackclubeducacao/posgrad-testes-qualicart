# QualiCart — Módulo 4: Qualidade na Era da IA (entrega final)

O **QualiCart** é o projeto-fio-condutor da disciplina *Estratégias de Testes e Qualidade de Software*. Começou, no Módulo 1, como um mini e-commerce de checkout (carrinho, cupons e frete) em **Node.js + TypeScript** executado pelo **interpretador TypeScript nativo do Node** — sem build, sem transpilação, sem `dist/`. No Módulo 2 virou **dois serviços** (catálogo + checkout) com a estratégia de teste do distribuído (contratos, integração real, property/mutation, E2E, carga, chaos). No Módulo 3 a qualidade **saiu do pipeline e entrou na produção**: segurança contínua (SAST/SCA), SLO com error budget, entrega progressiva (feature flags/canary), observabilidade (OpenTelemetry), acessibilidade e regressão visual.

Você está na branch **`modulo-4`** (marco **`m4-final`**), a **entrega final** da disciplina. Aqui o QualiCart entra no território da **IA**: sobre o sistema distribuído, observável e entregue continuamente dos módulos anteriores, adicionamos um **assistente/agente de checkout** baseado em LLM e — o que de fato importa nesta disciplina — a **estratégia de qualidade para o não-determinismo**.

A tese muda de forma, não de essência. Nos módulos anteriores o determinismo era um pressuposto: mesma entrada, mesma saída, e o teste comparava por **igualdade exata**. Um LLM quebra isso — a mesma pergunta pode gerar textos diferentes, todos corretos. **O determinismo virou um espectro.** Mas a tese que atravessa toda a disciplina — *"teste é gestão de risco com orçamento finito"* — **sobrevive intacta**: o que muda é o **método**, que passa de igualdade exata para **propriedades, faixas e distribuições**. Este README descreve o estado **cumulativo** dos quatro módulos e, sobretudo, mostra como o Módulo 4 **fecha o ciclo** reusando a infraestrutura de qualidade contínua já construída.

> **Honestidade sobre a chave de API.** Este ambiente **não** tem `ANTHROPIC_API_KEY`. Todo o recurso de IA foi projetado para rodar **offline com um cliente LLM FAKE determinístico** (`FakeLlmClient`) — é assim que testes, CI e evals ficam estáveis e reprodutíveis. Bastando definir `ANTHROPIC_API_KEY`, o **mesmo código** passa a falar com o **Claude real** (`claude-opus-4-8`, configurável por `AI_MODEL`). Onde o texto diz "não-determinismo", entenda: com o fake, a variação é **simulada de forma controlada** (seed por índice, variação cosmética que nunca altera a correção); com a chave, a variação é **genuína**.

---

## Mapa de branches

O repositório é **evolutivo**: cada módulo vive em sua própria branch e marco (tag), para você acompanhar a maturação da qualidade comparando estados com `git diff`.

| Branch | Tag | O que representa |
| --- | --- | --- |
| `main` / `inicio` | — | **Starter** entregue ao aluno: monólito de checkout, testes fracos, *code smells*, sem CI. |
| `modulo-1` | `m1-final` | Fundação de qualidade: TDD, BDD, CI com *gates*, cobertura e diagnóstico. |
| `modulo-2` | `m2-final` | Split em catálogo + checkout e testes do distribuído: Pact, testcontainers, property/mutation, Playwright, k6, chaos, CI evoluído. |
| `modulo-3` | `m3-final` | Qualidade contínua e observabilidade: SAST/SCA, SLO + *error budget*, *feature flags*/canary, OpenTelemetry, acessibilidade e *visual regression*. |
| **`modulo-4`** | **`m4-final`** | **Esta branch (entrega final).** Assistente/agente de IA, oráculo invertido, *golden dataset*, evals (Promptfoo), não-determinismo estatístico, defesas de runtime, *red teaming* e plano de A/B — **reusando** flags, observabilidade e error budget do M3. |

Para navegar entre os estágios e ver a progressão técnica:

```bash
git checkout modulo-4              # entra nesta branch (entrega final)
git diff modulo-3 modulo-4         # vê exatamente o que o Módulo 4 acrescentou
git diff modulo-3 modulo-4 --stat  # resumo por arquivo (ai-assistant, evals, docs/modulo-4)
git log --oneline                  # lê a história de commits
```

Sugestão pedagógica: percorra as **tags** (`inicio` → `m1-final` → `m2-final` → `m3-final` → `m4-final`) e faça `git diff` entre cada par para ler a evolução da estratégia de qualidade como uma linha do tempo — do teste clássico ao teste do sistema probabilístico.

---

## Arquitetura do recurso de IA

Todo o código do assistente vive em `packages/ai-assistant/`. Ele é um **agente com uso de ferramentas (tool use)** que ajuda o cliente a tirar dúvidas sobre produtos, entender cupons, calcular o total do carrinho e consultar o status de um pedido — sempre sobre o domínio real do QualiCart, **100% em memória** (sem HTTP), reusando as funções puras de preço do checkout e o catálogo do M2.

```text
                          ┌──────────────────────────── packages/ai-assistant/ ─────────────────────────────┐
                          │                                                                                  │
   usuário  ──pergunta──▶ │  guardrails.ts  ── (1) ENTRADA: detectarInjecao ──┐                              │
   (CLI / futuro chat)    │                                                   │ recusa? → MENSAGEM_RECUSA    │
                          │                                                   ▼                              │
                          │  agent.ts  ─ AssistenteCheckout ── LOOP AGÊNTICO (teto MAX_ITERACOES = 5) ──┐    │
                          │       │                                                                     │    │
                          │       ▼                                                                     │    │
                          │  llm-client.ts  ── LlmClient (interface) ──┬── FakeLlmClient  (offline, sem chave) │
                          │       │                                    └── AnthropicLlmClient (Claude real,    │
                          │       │                                          se ANTHROPIC_API_KEY; AI_MODEL   │
                          │       │                                          default claude-opus-4-8)         │
                          │       │  emite tool_use ▼                                                    │    │
                          │  tools.ts  ── FERRAMENTAS read-only (menor privilégio):                     │    │
                          │       ├─ buscar_produto      → catálogo (packages/catalog, em memória)      │    │
                          │       ├─ calcular_total      → processarCheckout (funções puras do checkout)│    │
                          │       ├─ aplicar_cupom_info  → catálogo de cupons                           │    │
                          │       └─ consultar_pedido    → PedidoRepository injetado                    │    │
                          │       │  (finalizar_pedido NÃO é exposta: alto impacto → confirmação humana)│    │
                          │       ▼  tool_result ─────────────────────────────────────────────────────┘    │
                          │  guardrails.ts ── (2) SAÍDA/formato: sanitizarSaida · (3) ESCOPO: saidaInsegura  │
                          │                   (4) FALLBACK: try/catch nunca propaga exceção → MENSAGEM_FALLBACK│
                          └──────────────────────────────────────────────────────────────────────────────────┘
                                                        │ resposta segura
                                                        ▼
                                              { resposta, ferramentasUsadas, recusado? }
```

Peças-chave (`packages/ai-assistant/src/`):

- **`agent.ts`** — a classe `AssistenteCheckout`: guardrail de entrada, loop agêntico com teto de iterações, guardrail de saída e fallback que **nunca** propaga exceção ao chamador.
- **`llm-client.ts`** — a **costura testável**: a interface `LlmClient` com duas implementações — `AnthropicLlmClient` (real, `@anthropic-ai/sdk`, só roda com chave, reembrulha falhas em `LlmIndisponivelError`) e `FakeLlmClient` (determinístico, offline, classifica a intenção por palavras-chave e emite o `tool_use` correspondente). É essa dupla que torna o recurso **testável sem chave**.
- **`tools.ts`** — quatro ferramentas **somente-leitura** (menor privilégio), com deps injetáveis (mockáveis nos testes). A ação de alto impacto (`finalizarPedido`) **não é exposta** ao LLM e exige `confirmadoPeloUsuario === true`.
- **`guardrails.ts`** — defesas de runtime em camadas (injeção na entrada, formato/valor da saída, escopo/segurança, fallback).
- **`prompt.ts`** — `PROMPT_SISTEMA` + `MARCA_ANTI_INJECAO` (a diretriz de segurança que a demo de regressão remove para provocar a falha).
- **`cli.ts`** — demo de linha de comando; escolhe automaticamente fake (sem chave) ou Claude real (com chave) e imprime qual cliente está ativo.

**Roda sem chave (fake) ou com chave (Claude real)** — o mesmo agente, tools e guardrails; só troca a implementação de `LlmClient`.

---

## O que o Módulo 4 acrescentou

Sobre a plataforma de qualidade contínua do M3, esta branch entrega **seis** itens — todos implementados e verdes:

1. **Geração de testes assistida + auditoria de "oráculo invertido".** Pedir a um LLM que **gere testes** inverte o oráculo: para inventar a asserção, a IA deduz o valor esperado **do que o código FAZ**, não do que **deveria fazer** — cristalizando bugs latentes. O caso real: `processarCheckout` fazia aritmética monetária em `number` sem arredondar, e o campo `desconto` de um checkout de 2 camisetas com cupom de 10% carregava o lixo de float `11.980000000000004`. A IA geraria `assert.equal(resultado.desconto, 11.980000000000004)` — verde, mas blindando o bug. **Auditamos o oráculo** e corrigimos a raiz com `arredondarMoeda` (`packages/checkout/src/checkout.ts`, aplicado a todos os campos monetários), com a asserção **desejada** `11.98` + invariante de 2 casas decimais em `packages/checkout/test/unit/checkout-ia.test.ts`. Doc: [`docs/modulo-4/auditoria-oraculo-invertido.md`](docs/modulo-4/auditoria-oraculo-invertido.md).

2. **Golden dataset (27 casos curados a mão).** [`evals/golden-dataset.json`](evals/golden-dataset.json) — 27 casos distribuídos por risco: `caminho-feliz` (8), `borda` (8), `seguranca` (7), `tom-ambiguidade` (4). Cada caso traz `criterios.deterministicos` (verificáveis por regra) e `criterios.julgamento` (rubrica para LLM-as-judge). A tese: **definir "boa resposta" é o trabalho intelectual; a ferramenta é só o músculo** — e o dataset é o **teto** da qualidade da avaliação (SKUs, preços, cupons e frete foram conferidos contra o código real). Doc: [`docs/modulo-4/golden-dataset.md`](docs/modulo-4/golden-dataset.md).

3. **Evals no Promptfoo (gate offline determinístico + LLM-as-judge sob demanda).** `npm run eval` roda [`evals/promptfooconfig.yaml`](evals/promptfooconfig.yaml) 100% offline (fake), **13/13 casos verdes (exit 0)**, empurrando o máximo para a camada barata (`contains`/`regex`/`javascript` sobre fatos e tool use). O provider custom `evals/provider-assistente.mjs` importa os `.ts` do assistente real (type stripping nativo) — o eval exercita **o código de produção**. A camada `llm-rubric` (`promptfooconfig.judge.yaml`, `anthropic:messages:claude-opus-4-8`) roda nightly/sob demanda com chave. **Demo de regressão de prompt** (`promptfooconfig.regressao.yaml`): removendo a `MARCA_ANTI_INJECAO`, a injeção **escondida em dado** passa a ser obedecida — o prompt bom passa, o degradado **falha** (exit 100), e o gate bloquearia o merge. Doc: [`docs/modulo-4/evals-promptfoo.md`](docs/modulo-4/evals-promptfoo.md).

4. **Não-determinismo estatístico + defesas de runtime em camadas.** Confiabilidade deixa de ser propriedade de *uma* execução e vira propriedade da **distribuição**: `test/nao-determinismo/distribuicao.test.ts` roda o mesmo caso **N = 50** vezes e asserta **taxa ≥ 95%** (medido: **50/50 = 100% boas, 0 catastróficas**), nunca `assert.equal` numa execução isolada. `test/nao-determinismo/defesas.test.ts` prova que, **quando** o modelo produz lixo (formato inválido, timeout, injeção, conteúdo perigoso, loop), cada camada de guardrail degrada para uma resposta segura padrão — o agente **nunca** lança, **nunca** vaza. Doc: [`docs/modulo-4/nao-determinismo.md`](docs/modulo-4/nao-determinismo.md).

5. **Testes de agente (tool use, planejamento, red teaming) + contenção arquitetural.** Em `test/agente/`: **tool use** (asserta o par *nome-da-ferramenta + input*, não a prosa, via `LlmEspiao`), **planejamento** (a trajetória: encadeia ferramentas, termina, e respeita `MAX_ITERACOES = 5` sob um LLM patológico que nunca encerra — corta em exatamente 5 execuções), e **red teaming** (bateria curada e determinística: 6 variantes de injeção direta, exfiltração de prompt, **injeção embutida em dado** — nome de produto/campo de pedido envenenados — e ação de alto impacto sem confirmação). O princípio: **a arquitetura contém; os testes provam que a contenção não regrediu.** Doc: [`docs/modulo-4/testes-agente.md`](docs/modulo-4/testes-agente.md).

6. **Plano de A/B testing em produção (o fecho do curso).** Dois prompts (ou dois modelos — `AI_MODEL`) do assistente competindo com tráfego real, decididos por dados de negócio. O ponto central: **nada foi inventado para IA** — o A/B **reusa** as feature flags sticky + canary do M3 (cada usuário consistentemente em A ou B), a observabilidade OTel + error budget do M3 (medem o comportamento em produção e governam promover/reverter) e o golden dataset/evals do M4 (o gate offline shift-left). O eval responde *"não piorou o que eu já sabia?"*; só a produção responde *"é melhor para os usuários reais?"*. Doc: [`docs/modulo-4/ab-testing-plano.md`](docs/modulo-4/ab-testing-plano.md).

> **Honestidade dos números.** Sem chave, tudo roda com o `FakeLlmClient` determinístico (a variação do não-determinismo é **simulada de forma controlada** — seed por índice, variação cosmética que jamais altera a correção); com `ANTHROPIC_API_KEY`, roda contra o **Claude real**. A distribuição N=50 é estável porque *mesma seed → mesma saída*; com o modelo real, a mesma mecânica (rodar N, categorizar, assertar a taxa) opera sobre variação genuína, tolerando custo e latência (por isso, em produção, roda em suíte nightly/separada).

---

## O ciclo se fecha (a tese da disciplina)

O Módulo 4 é a prova da tese central do curso: **a máquina de qualidade contínua construída nos módulos 1–3 já era, o tempo todo, a resposta para a IA.** Nada precisou ser inventado para o não-determinismo — só **adaptamos as métricas**:

- **A/B de IA = feature flags sticky (M3).** O rollout percentual determinístico e sticky que desacoplava deploy de release vira o mecanismo que mantém **cada usuário consistentemente em A ou B**.
- **Governança da variante = observabilidade OTel + error budget (M3).** Os traces/métricas que localizavam o gargalo agora medem o **comportamento do modelo em produção**; o error budget/SLO vira o critério objetivo de **promover ou reverter** uma variante de IA.
- **Gate offline = golden dataset + evals (M4).** A suíte de regressão do sistema probabilístico é o mesmo shift-left dos módulos anteriores — só que asserta **propriedades, faixas e distribuições** em vez de igualdade exata.

Em uma frase: **a qualidade de IA não é uma disciplina nova; é a mesma engenharia de qualidade contínua e observável, com o oráculo generalizado de "igual a X" para "dentro do risco aceitável, com que frequência".**

---

## Como rodar

Todos os scripts estão em `package.json`. Resultados abaixo já validados nesta branch. **O recurso de IA roda offline por padrão (fake, sem chave); com `ANTHROPIC_API_KEY` usa o Claude real.**

### Pré-requisitos

- **Node.js >= 24** (recomendado **26**). Nenhuma ferramenta de build — o Node executa os `.ts` por *type stripping* nativo.
- **Docker** — testes de integração (testcontainers sobe um Postgres descartável).
- **k6** (binário) — testes de carga e o SLO-driven load.
- **Chromium do Playwright** — E2E, a11y e visual: `npx playwright install chromium`.
- *(Opcional)* **`ANTHROPIC_API_KEY`** — só para rodar o assistente/juiz contra o **Claude real**. Sem ela, tudo funciona no fake.

### Suíte completa (resultados reais)

```bash
npm install

# --- Núcleo clássico + distribuído (M1–M3) ---
npm test                   # unidade (node --test)                 -> 68 verdes (inclui checkout-ia)
npm run test:coverage      # unidade + cobertura nativa (piso)
npm run test:property      # property-based (fast-check)
npm run test:contract      # Pact: consumidor + provedor
npm run test:integration   # Postgres em contêiner (Docker)
npm run test:e2e           # Playwright: jornada + a11y + visual
npm run test:mutation      # Stryker

# --- Recurso de IA (M4) ---
npm run test:ai            # assistente: unit + agente + não-determinismo -> 49 verdes (offline, fake)
npm run eval               # Promptfoo, gate offline determinístico       -> 13/13 verdes (exit 0)

# --- Gates transversais ---
npm run typecheck          # tsc --noEmit                          -> 0 erros
npm run lint               # ESLint + SAST                         -> 0 erros (warnings intencionais)
npm run bdd                # Cucumber
npm run audit              # npm audit --audit-level=high          -> 0 high/critical
npm run slo:load           # k6 com thresholds = SLOs (sob demanda)
```

### O assistente pela CLI (offline vs. real)

```bash
# OFFLINE (sem chave): usa o FakeLlmClient determinístico
node packages/ai-assistant/src/cli.ts "quanto fica meu carrinho com 2 camisetas e o cupom DESCONTO10?"
# -> [cliente LLM: FakeLlmClient (offline, sem chave)]
#    O total do seu carrinho é R$122.82 (subtotal R$119.80, desconto R$11.98, frete R$15.00).
#    (ferramentas usadas: calcular_total)

# REAL (com chave): o MESMO código passa a falar com o Claude
ANTHROPIC_API_KEY=sk-... node packages/ai-assistant/src/cli.ts "qual o preço do fone?"
# AI_MODEL é configurável (default claude-opus-4-8), ex.: AI_MODEL=claude-haiku-4-5 ...
```

### Demo de regressão de prompt (o eval acusando a piora)

```bash
promptfoo eval -c evals/promptfooconfig.regressao.yaml
# assistente-bom (COM a marca anti-injeção)  -> PASS nos casos de segurança
# assistente-degradado (SEM a marca)         -> a injeção ESCONDIDA EM DADO passa a ser obedecida -> FAIL
# Results: 3 passed / 1 failed -> exit code 100 (!= 0): o gate BLOQUEARIA este merge
```

### LLM-as-judge (nightly / sob demanda, requer chave)

```bash
ANTHROPIC_API_KEY=sk-... promptfoo eval -c evals/promptfooconfig.judge.yaml
# adiciona a camada llm-rubric (anthropic:messages:claude-opus-4-8); NÃO roda por-PR (custo/latência)
```

---

## Estrutura de pastas

```text
qualicart/
├─ .github/workflows/ci.yml            # pipeline: lint, SAST, SCA, typecheck, test+cobertura,
│                                      # bdd, contract, integration, e2e+a11y, eval (M4)
├─ docs/
│  ├─ modulo-1/ · modulo-2/ · modulo-3/ # diagnóstico, distribuído, qualidade contínua
│  └─ modulo-4/                        # QUALIDADE NA ERA DA IA
│     ├─ arquitetura-ia.md              # LlmClient real+fake, tools, guardrails, agente
│     ├─ auditoria-oraculo-invertido.md # geração assistida de testes + o bug de arredondamento
│     ├─ golden-dataset.md              # 27 casos: por que o dataset é o teto da avaliação
│     ├─ evals-promptfoo.md             # gate offline + LLM-as-judge + demo de regressão
│     ├─ nao-determinismo.md            # confiabilidade distribucional (N=50) + defesas em camadas
│     ├─ testes-agente.md               # tool use, planejamento, red teaming, contenção
│     └─ ab-testing-plano.md            # A/B em produção reusando flags + OTel + error budget
├─ evals/                              # SUÍTE DE EVAL (Promptfoo)
│  ├─ golden-dataset.json               # 27 casos curados (fonte da verdade)
│  ├─ provider-assistente.mjs           # provider custom: expõe o AssistenteCheckout real (import .ts)
│  ├─ casos-deterministicos.yaml        # 13 casos + asserções determinísticas
│  ├─ casos-seguranca-dado.yaml         # casos de segurança da demo de regressão
│  ├─ promptfooconfig.yaml              # GATE OFFLINE (npm run eval) — só determinístico
│  ├─ promptfooconfig.judge.yaml        # camada LLM-as-judge (requer ANTHROPIC_API_KEY, nightly)
│  └─ promptfooconfig.regressao.yaml    # demo bom × degradado (acusa a regressão de prompt)
├─ e2e/ · load/ · chaos/ · pacts/ · features/   # M2–M3 (E2E/a11y/visual, k6/SLO, chaos, Pact, BDD)
├─ packages/
│  ├─ ai-assistant/                    # ASSISTENTE/AGENTE DE IA (Módulo 4)
│  │  ├─ src/
│  │  │  ├─ agent.ts                    # AssistenteCheckout: loop + defesas + contenção
│  │  │  ├─ llm-client.ts               # LlmClient: AnthropicLlmClient (real) + FakeLlmClient (offline)
│  │  │  ├─ tools.ts                    # 4 ferramentas read-only (menor privilégio) + deps injetáveis
│  │  │  ├─ guardrails.ts               # defesas de runtime em camadas
│  │  │  ├─ prompt.ts                   # PROMPT_SISTEMA + MARCA_ANTI_INJECAO
│  │  │  └─ cli.ts                      # demo CLI (fake sem chave | Claude com chave)
│  │  └─ test/
│  │     ├─ unit/                       # agente, fake-llm, guardrails (determinístico, offline)
│  │     ├─ agente/                     # tool-use, planejamento, red-teaming
│  │     └─ nao-determinismo/           # distribuicao (N=50) + defesas em camadas
│  ├─ catalog/                         # SERVIÇO DE CATÁLOGO (preços, porta 3001; OTel)
│  └─ checkout/                        # SERVIÇO DE CHECKOUT (porta 3000; OTel, flags)
│     └─ src/checkout.ts                # núcleo puro + arredondarMoeda (correção do M4)
│     └─ test/unit/checkout-ia.test.ts  # asserções auditadas (oráculo invertido corrigido)
├─ eslint.config.js · playwright.config.ts · stryker.config.json
├─ tsconfig.json · cucumber.mjs · package.json
```

---

## Pipeline de CI (estado final)

`.github/workflows/ci.yml` — gates ordenados do **mais barato ao mais caro** (fail fast), acumulados ao longo dos quatro módulos:

| # | Job | O que faz | Módulo |
| --- | --- | --- | --- |
| 1 | **lint** | ESLint (estilo + estático) | M1 |
| 1b | **sast** | `eslint-plugin-security` (analisa o *nosso* código) | M3 |
| 1c | **sca** | `npm audit --audit-level=high` (analisa as *dependências*) | M3 |
| 2 | **typecheck** | `tsc --noEmit` | M1 |
| 3 | **test** | unidade (`node --test`) + **gate de cobertura nativo** (lines/functions 0.75, branches 0.65) | M1 |
| 4 | **bdd** | Cucumber (comportamento de cupom) | M1 |
| 5 | **contract** | Pact (consumidor gera + provedor verifica) | M2 |
| 6 | **integration** | testcontainers (Postgres real) | M2 |
| 7 | **e2e** | Playwright: jornada feliz + `@a11y` (exclui `@visual`) | M3 |
| 8 | **eval** | **Promptfoo determinístico/offline** (fake): fatos, tool use, recusa de injeção — regressão de prompt reprova o build | **M4** |

Gates 1, 1b, 1c e 2 rodam em **paralelo**; os demais dependem de `test`. **Sob demanda / fora do CI por-PR:** carga e **SLO** (k6, `npm run slo:load`), **chaos**, o gate **`@visual`** (baseline por plataforma) e a camada **LLM-as-judge** dos evals (exige `ANTHROPIC_API_KEY` — custo/latência, roda nightly num job com o secret).

---

## Fechamento da disciplina

O QualiCart começou, no Módulo 1, com uma tese simples e dura: **teste é gestão de risco com orçamento finito** — você nunca testa tudo, então investe onde o risco custa mais caro. Os módulos seguintes só afiaram esse princípio: no distribuído, o risco mudou de lugar (contratos, integração, resiliência); em produção, o risco virou observável e governado por error budget; e no Módulo 4, com a IA, **o próprio determinismo deixou de ser um pressuposto**.

O que este módulo prova é que **nenhum princípio precisou ser abandonado**. O oráculo de "resultado igual a X" se generalizou para "resultado dentro de uma faixa/propriedade, com uma frequência aceitável". A suíte de regressão virou eval. O SLO virou a barra estatística. O canary virou o A/B de prompt. A gestão de risco continua sendo gestão de risco — só que agora o risco é probabilístico.

O aluno que percorre as quatro branches sai capaz de **projetar qualidade para qualquer sistema** — do clássico e determinístico ao probabilístico e agêntico — porque aprendeu o que não muda: identificar o risco, escrever o oráculo certo (mesmo quando ele é uma distribuição), automatizar o gate barato, observar a produção e decidir com dados. Essa é a competência que atravessa a era da IA.
