# Plano de A/B testing de prompts/modelos em produção (Módulo 4, item 6)

> Este é o **fecho do curso**. O desafio inteiro constrói uma máquina de
> qualidade contínua; aqui ela é apontada para o não-determinismo da IA. O ponto
> central e recorrente deste documento: **nada abaixo foi inventado para IA**. O
> A/B em produção reusa, peça por peça, a infraestrutura dos módulos anteriores —
> feature flags com rollout sticky e canary (M3), observabilidade OpenTelemetry e
> error budget (M3), golden dataset e evals (M4). O que muda é apenas o *conteúdo*
> das métricas, adaptadas a um sistema que **não dá sempre a mesma resposta**.

O experimento concreto: colocar **dois prompts (ou dois modelos)** do assistente
de checkout (`packages/ai-assistant/`) para competir com **tráfego real** e
decidir, por dados de negócio, qual promover.

---

## 1. Por que o offline (eval + golden dataset) não basta

No Módulo 4 construímos um **golden dataset** e **evals** (`evals/`, doc
`docs/modulo-4/golden-dataset.md`): um conjunto curado de casos com a resposta/
comportamento esperado, que roda como **gate offline** (shift-left) antes de
qualquer entrega. Isso é indispensável — pega regressões conhecidas (por exemplo,
a regressão de injeção que o próprio código instrumenta: remover a
`MARCA_ANTI_INJECAO` de `prompt.ts` faz o agente obedecer a instruções embutidas).

Mas o golden dataset é, por construção, uma **aproximação**:

- **É um recorte finito** do mundo. Os usuários reais escrevem de formas que
  ninguém antecipou; a cauda longa de perguntas não está no dataset.
- **Mede "acertou o esperado?", não "foi melhor para o usuário?"**. Um eval
  pontua correção/formato/segurança. Ele não sabe se o cliente **finalizou o
  checkout**, se **desistiu**, se **reperguntou** por não ter entendido, nem
  quanto **custou** ou **demorou** aquela resposta.
- **É estável e determinístico de propósito** (roda com o `FakeLlmClient`); a
  produção é ruidosa, não-determinística e influenciada por contexto que o
  dataset não captura.

Por isso o A/B em produção é **shift-right aplicado à IA**: assim como o Módulo 3
observa o SLI real em produção porque o teste de carga sozinho não prova
confiabilidade, aqui observamos o **comportamento real do usuário** porque o eval
sozinho não prova utilidade. O eval responde *"não piorou o que eu já sabia?"*; só
a produção responde *"é melhor para os usuários reais?"*.

---

## 2. Hipótese e variantes

**Hipótese:** "Uma variante B do assistente aumenta a taxa de checkout concluído
após interação, sem degradar segurança, custo e latência além dos guardrails."

O experimento suporta os dois eixos de variação que o código já expõe:

| Eixo | Braço A (controle = produção atual) | Braço B (variante) | Onde vive |
|------|-------------------------------------|--------------------|-----------|
| **Prompt** | `PROMPT_SISTEMA` atual (`prompt.ts`) | Prompt mais **conciso/direto** (mesmas regras de segurança e escopo, menos texto de cortesia) | `system` é injetável via `OpcoesAgente.system` no `AssistenteCheckout` |
| **Modelo** | `claude-opus-4-8` (default do `AnthropicLlmClient`) | `claude-haiku-4-5` (mais barato/rápido, talvez menos preciso) | `AI_MODEL` por env, lido no construtor do `AnthropicLlmClient` |

Escolha **um eixo por experimento** (não misture prompt e modelo no mesmo teste,
senão não se sabe qual mudança causou o efeito). Um caso didático forte é o eixo
de **modelo**: a hipótese "Haiku é bom o suficiente e muito mais barato" é
exatamente o tipo de aposta que só a produção resolve — ver seção 4.

**Restrição inegociável:** a variante B **mantém as regras de segurança
invioláveis** — a `MARCA_ANTI_INJECAO` continua no prompt B, e os guardrails de
runtime (`detectarInjecao`, `saidaInsegura`, `sanitizarSaida`, fallback) do
`agent.ts` valem para os dois braços. B pode ser mais conciso, nunca menos seguro.

---

## 3. Roteamento por feature flag (reuso direto do M3)

O tráfego A/B é dividido pela **mesma** função de flag do Módulo 3:
`isEnabled(flag, { chave })` em `packages/checkout/src/flags.ts` (doc
`docs/modulo-3/feature-flags-canary.md`). Nenhuma infraestrutura nova de
roteamento é criada.

**A propriedade que torna isso um A/B honesto é a stickiness.** A decisão é
determinística por `hashString('flag:chave') % 100 < rolloutPercent` (FNV-1a). Com
a **chave = id da sessão/usuário**, o *mesmo* usuário cai *sempre* no mesmo braço
durante todo o experimento. Sem isso, o usuário oscilaria entre A e B a cada
mensagem, poluindo a comparação e criando uma experiência incoerente.

Nova flag do experimento:

```jsonc
// FLAGS='{"assistenteVarianteB":{"enabled":true,"rolloutPercent":50}}'
assistenteVarianteB: { enabled: true, rolloutPercent: 50 }
```

Como o assistente escolhe o braço (na fábrica que constrói o `AssistenteCheckout`
para a sessão):

```ts
const braoB = isEnabled('assistenteVarianteB', { chave: idSessao });
const braco = braoB ? 'B' : 'A';

const assistente = braoB
  ? new AssistenteCheckout(clienteB, { system: PROMPT_SISTEMA_B }) // ou AI_MODEL=claude-haiku-4-5
  : new AssistenteCheckout(clienteA, { system: PROMPT_SISTEMA });  // controle
```

Observações de método:

- **A/B é canary com dois lados.** No M3 o canary ia 5% → 25% → 100% ligando o
  comportamento novo; aqui o `rolloutPercent` define **quanto** do tráfego vê B.
  Começa-se pequeno (ex.: 5–10%) para limitar exposição e cresce conforme B se
  prova — a mesma progressive delivery, agora comparativa.
- **Reversão em segundos**: `assistenteVarianteB.enabled = false` devolve 100% do
  tráfego a A sem novo deploy (desacopla deploy de release, exatamente como no M3).
- **Fail-closed**: flag desconhecida ou sem chave em rollout parcial → `false` →
  o usuário fica no controle A (o lado seguro/atual). Comportamento herdado do
  `isEnabled`, não reimplementado.

---

## 4. Métricas de NEGÓCIO (não só "resposta correta")

Este é o coração da adaptação ao não-determinismo. O eval offline mede correção;
a produção precisa medir **valor para o usuário e para o negócio**, por braço:

| Métrica | Sinal | O que captura |
|---------|-------|---------------|
| **Tarefa concluída** | explícito, primário | % de sessões que **finalizam o checkout** após interagir com o assistente. É a métrica-norte. |
| **Feedback (joinha)** | explícito | 👍/👎 na resposta — satisfação declarada. |
| **Reperguntar / reformular** | **implícito de falha** | usuário repete/reescreve a mesma pergunta → o assistente não resolveu de primeira. Sinal barato e poderoso. |
| **Abandono após resposta** | implícito de falha | sessão encerra logo após a resposta, sem concluir a tarefa. |
| **Custo por interação** | eficiência | tokens de entrada+saída × preço do modelo. Central no eixo Opus vs. Haiku. |
| **Latência p95** | eficiência | o **mesmo percentil** que o SLO do checkout usa (`docs/modulo-3/slo-error-budget.md`, p95 < 250 ms / p99 < 400 ms). |
| **Taxa de recusa/fallback** | guardrail | quantas vezes B caiu em `MENSAGEM_RECUSA`/`MENSAGEM_FALLBACK`. Sobe demais = B está pior, não mais seguro. |

**A lição pedagógica central:** *um modelo melhor no eval pode ser pior no
negócio.* Suponha que Opus (A) acerte 2 pontos percentuais a mais no golden
dataset, mas Haiku (B) seja **5× mais barato** e **3× mais rápido**, com **a
mesma** taxa de checkout concluído e de reperguntas. Pelo eval, A vence; pelo
negócio, **B vence** — entrega o mesmo resultado ao usuário, mais barato e mais
rápido, o que aumenta conversão (latência afeta conversão) e margem. O eval é
condição necessária (gate), **não** critério de decisão de produto.

---

## 5. Observabilidade para coleta (reuso direto do M3)

A coleta usa a **mesma** instrumentação OpenTelemetry do Módulo 3
(`packages/*/src/instrumentation.ts`, doc `docs/modulo-3/observabilidade.md`):
traces distribuídos + métricas (contadores/histogramas). Nenhum pipeline de dados
novo — só **novos atributos e métricas** no mesmo SDK.

Como cada braço é medido, seguindo a "Definition of Done" de instrumentar do M3:

- **Span da interação do assistente** com o atributo discriminante
  **`assistente.braco = A | B`** (e `assistente.modelo`, `assistente.prompt_versao`).
  Como o span do assistente fica aninhado no trace `POST /checkout` já existente,
  dá para correlacionar a interação com a **conclusão real da compra** no mesmo
  `traceId` — é assim que "tarefa concluída" vira dado.
- **Atributos por interação**: entrada (intenção/tamanho), saída
  (`recusado`, `ferramentasUsadas`), **custo** (tokens in/out), **latência** (duração
  do span), e o **sinal de qualidade** (joinha, repergunta detectada).
- **Métricas novas** no mesmo estilo das do M3 (`qualicart.checkout.duracao`,
  `qualicart.checkouts.processados`):
  - `qualicart.assistente.duracao` — histograma, atributo `braco`.
  - `qualicart.assistente.tokens` — histograma de custo, atributo `braco`.
  - `qualicart.assistente.tarefa_concluida` — contador, atributos `braco`, `resultado`.
  - `qualicart.assistente.fallback` — contador de recusa/fallback por `braco`.

Como toda métrica carrega o atributo `braco`, comparar A vs. B é **filtrar por
atributo** no backend (Jaeger/Tempo/Datadog) — exatamente as "perguntas novas sem
novo deploy" que a doc de observabilidade define.

**O error budget governa o risco do experimento** (reuso do M3,
`docs/modulo-3/slo-error-budget.md`): B é um consumidor de budget como qualquer
canary. Calcula-se o **burn rate por braço** sobre o SLI real (erro/latência). Se
B **queima budget rápido** (ex.: p99 estoura 400 ms, ou fallback dispara acima do
limite, ou disponibilidade cai), o **rollback automático** desliga
`assistenteVarianteB` *antes* de o budget global estourar — a flag é o botão, o
error budget é o critério. Guardrail assimétrico: B só ganha tempo se **não**
estiver queimando budget.

---

## 6. Critério de decisão

O experimento termina com uma decisão objetiva, não com "achismo":

- **Duração e volume mínimos**: rodar pelo menos um **ciclo de negócio completo**
  (dias/semanas cobrindo dias úteis e fim de semana) e atingir **amostra suficiente
  por braço** para significância estatística na métrica-norte (checkout concluído).
  Não decidir em picos ou promoções atípicas.
- **Significância**: a diferença na métrica primária precisa ser
  **estatisticamente significativa** (não ruído do não-determinismo). Métricas
  secundárias (custo, latência, repergunta) entram como suporte e como
  *tie-breakers*.
- **Guardrails sempre ativos** (não negociáveis, herdados do `agent.ts` e do
  error budget): segurança anti-injeção, escopo, fallback, e os limites de SLO. Um
  braço que viole qualquer guardrail é **descartado imediatamente**, por melhor que
  esteja nas métricas de negócio.
- **Promover B a 100%** se, com significância: tarefa concluída ≥ A, sinais
  implícitos de falha (repergunta/abandono) ≤ A, guardrails intactos, e custo/
  latência iguais ou melhores (ou o ganho de negócio compensa a piora de custo/
  latência dentro do budget). Promoção = subir `rolloutPercent` a 100 (mesma
  mecânica do canary do M3).
- **Reverter (voltar a A)** se B piora a métrica-norte, aumenta reperguntas/
  fallback, ou queima error budget. Reversão = `enabled: false`, segundos, sem
  deploy.
- **Inconclusivo** (empate dentro do ruído): mantém A (o barato de operar) ou
  refina a hipótese e repete. No eixo de modelo, empate de negócio + B mais barato
  = **B vence pelo custo**.

---

## 7. Retroalimentação do golden dataset (fechando o ciclo)

Aqui o M4 se realimenta do que a produção observou. Os casos reais em que o
sistema **patinou** — colhidos pela observabilidade da seção 5 — são ouro:

- Sessões com **repergunta/abandono**, **joinha negativo**, **fallback/recusa
  indevida**, ou respostas que o cliente marcou como ruins.
- Cada um desses vira um **novo caso do golden dataset** (`evals/`,
  `docs/modulo-4/golden-dataset.md`): a pergunta real do usuário + o comportamento
  esperado (definido agora que sabemos o que deveria ter acontecido).

Com isso, o **próximo eval** já cobre a falha que a produção revelou: o que era
cauda longa desconhecida vira caso conhecido e **regressão testável offline**. O
dataset **cresce guiado por produção**, deixando de ser um recorte estático e
passando a rastrear o comportamento real dos usuários. É o mesmo espírito do loop
SLO do M3 ("produção é o julgamento contínuo que ajusta a meta"), agora
alimentando o gate de IA.

---

## 8. O ciclo completo (a máquina de qualidade contínua)

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
        ▼                                                              │
  ┌───────────┐   gate     ┌──────────────────┐   canary/rollout %   ┌───────────────────────┐
  │  EVAL     │  offline   │  FEATURE FLAG     │  sticky por usuário  │  A/B EM PRODUÇÃO       │
  │ (golden   │ ─────────► │  isEnabled(...)   │ ───────────────────► │  A vs B, tráfego real  │
  │  dataset) │  shift-    │  M3 flags/canary  │                      │  + guardrails/fallback │
  │  M4       │  left      └──────────────────┘                      │  + métricas de negócio │
  └───────────┘                                                       └───────────┬───────────┘
        ▲                                                                         │
        │                                                                         ▼
        │                                                             ┌───────────────────────┐
        │                                                             │  OBSERVAÇÃO            │
        │   novos casos (falhas reais)                                │  OTel: custo/latência/ │
        │   RETROALIMENTAÇÃO                                          │  qualidade por braço   │
        │                                                             │  error budget / burn   │
        └─────────────────────────────────────────────────────────── │  (queimou → aborta B)  │
                                                                      └───────────────────────┘
```

**Leitura do ciclo:** `EVAL` (gate offline, M4) libera a entrega → `FEATURE FLAG`
com canary sticky (M3) roteia o tráfego → `A/B EM PRODUÇÃO` compara A vs. B com
guardrails/fallback sempre ativos e **métricas de negócio** → `OBSERVAÇÃO` (OTel +
error budget, M3) mede cada braço e aborta se queimar budget → `RETROALIMENTAÇÃO`
converte as falhas reais em novos casos do golden dataset, fortalecendo o próximo
eval. Offline → entrega → produção → observação → retroalimentação → offline.

**O recado do fecho do curso:** não há "engenharia de qualidade de IA" separada.
Há a **mesma** engenharia de qualidade contínua dos módulos anteriores — flags,
canary, observabilidade, error budget, dataset de regressão — com as **métricas
adaptadas ao não-determinismo**: em vez de "a saída é exatamente esta?", pergunta-
se "os usuários reais estão melhores, dentro dos guardrails e do budget?". A
maquinaria é a mesma; muda a régua.

---

## Referências (peças reusadas)

- **Flags / canary (M3):** `packages/checkout/src/flags.ts` (`isEnabled`,
  rollout sticky por hash) · `docs/modulo-3/feature-flags-canary.md`
- **Observabilidade (M3):** `packages/*/src/instrumentation.ts` ·
  `docs/modulo-3/observabilidade.md`
- **SLO / error budget (M3):** `docs/modulo-3/slo-error-budget.md`
- **Golden dataset / evals (M4):** `evals/` · `docs/modulo-4/golden-dataset.md`
- **Assistente (M4):** `packages/ai-assistant/src/` — `agent.ts`
  (`AssistenteCheckout`, `system` injetável), `llm-client.ts` (`AnthropicLlmClient`,
  `AI_MODEL`), `prompt.ts` (`PROMPT_SISTEMA`, `MARCA_ANTI_INJECAO`) ·
  `docs/modulo-4/arquitetura-ia.md`
