# SLO-driven testing e error budget (checkout QualiCart)

> Módulo 3 — desafio item 2. Este documento define os **SLOs** do checkout,
> transforma esses SLOs em **thresholds de um teste de carga k6** (o teste
> passa a REPROVAR quando o SLO é violado) e calcula o **error budget**
> correspondente, conectando com feature flags/canary (Módulo 3), com a
> observabilidade e com o DORA.

---

## 1. SLI, SLO e SLA: mede, mira, promete

Três siglas parecidas que costumam ser confundidas. A régua para distingui-las:

| Termo   | O que é                                             | Verbo    | Exemplo no checkout |
|---------|-----------------------------------------------------|----------|---------------------|
| **SLI** | *Service Level Indicator* — a **métrica** medida    | **mede** | % de checkouts com HTTP 200; latência p99 do `POST /checkout` |
| **SLO** | *Service Level Objective* — a **meta** interna sobre o SLI | **mira** | ≥ 99,5% de sucesso no mês; p99 < 400ms |
| **SLA** | *Service Level Agreement* — a **promessa** contratual (com multa) | **promete** | 99,0% no mês, senão desconto na fatura |

Regra de ouro: o **SLO é sempre mais rígido que o SLA**. A folga entre eles é a
margem de segurança da engenharia — quando o SLO começa a ser violado, ainda há
tempo de reagir antes de quebrar o contrato (SLA) e pagar multa.

- **SLI** = o termômetro (o número cru).
- **SLO** = a temperatura-alvo que queremos manter.
- **SLA** = o que foi prometido ao cliente por escrito.

---

## 2. Os SLOs do checkout

Definimos **três** SLOs para o `POST /checkout`, ancorados em dois SLIs
(disponibilidade e latência). Os números são realistas para o ambiente local,
mas o ponto pedagógico é a **meta ancorada em SLO**, não o valor absoluto.

| # | SLO | SLI medido | Meta | Janela |
|---|-----|------------|------|--------|
| 1 | **Disponibilidade** | proporção de requisições de checkout com sucesso (não-5xx) | **≥ 99,5%** | 30 dias |
| 2 | **Latência de cauda** | p99 da duração do `POST /checkout` | **p99 < 400 ms** | 30 dias |
| 3 | **Latência típica** | p95 da duração do `POST /checkout` | **p95 < 250 ms** | 30 dias |

Justificativa dos números:

- **99,5% (dois "noves e meio")** é uma meta honesta para um serviço de e-commerce
  local: permite ~0,5% de erro, o suficiente para absorver deploys, reinícios e
  falhas transitórias da dependência (catálogo) sem alarme falso.
- **p99 < 400 ms** protege a **cauda**: mesmo o usuário mais azarado (1 em 100)
  tem uma resposta abaixo de 400 ms. É a métrica que mais impacta conversão.
- **p95 < 250 ms** garante que a **experiência típica** (95% dos usuários) seja
  claramente rápida. Medir só a média esconde a cauda; por isso miramos percentis.

---

## 3. Error budget: o "orçamento de falha"

Se o SLO de disponibilidade é 99,5%, o complemento é o **error budget**:

```
error budget = 100% - SLO = 100% - 99,5% = 0,5%
```

Esse 0,5% é uma **permissão de falhar**. Ele existe porque perseguir 100% é
economicamente irracional (o custo cresce exponencialmente a cada "nove") e
porque **é o orçamento que compra a velocidade de entrega**: todo deploy, canary
ou experimento consome um pouco dele. Se sobra budget, pode-se arriscar mais; se
o budget está no vermelho, congela-se o risco.

### 3.1 Traduzindo 0,5% em números concretos

Suponha um volume hipotético de **1.000.000 de checkouts/mês**:

| Métrica | Cálculo | Resultado |
|---------|---------|-----------|
| Requisições que podem falhar/mês | 1.000.000 × 0,5% | **5.000 checkouts** |
| Requisições que podem falhar/dia (≈33,3k/dia) | 5.000 ÷ 30 | **~166 checkouts/dia** |
| Indisponibilidade em tempo (mês de 30 dias = 43.200 min) | 43.200 × 0,5% | **216 minutos ≈ 3h36 min/mês** |
| Indisponibilidade permitida por dia | 216 ÷ 30 | **~7,2 min/dia** |

Ou seja: o serviço pode ficar fora do ar **~3h36 por mês** (ou errar **5.000
checkouts**) e ainda assim **cumprir** o SLO. Passou disso, o budget estourou.

### 3.2 Burn rate (taxa de consumo)

O que importa no dia a dia não é só o saldo, mas a **velocidade** com que o budget
é gasto — o **burn rate**:

```
burn rate = taxa de erro observada / taxa de erro do budget (0,5%)
```

- burn rate **1×** → gastando o budget exatamente no ritmo de 30 dias (ok).
- burn rate **10×** → o budget de 30 dias evapora em **3 dias** (alerta rápido).
- burn rate **> 14,4×** por 1h → padrão SRE de **página/alerta imediato**.

O burn rate é o que dispara os alertas de observabilidade do Módulo 3.

---

## 4. SLO-driven testing: o threshold É o SLO

No Módulo 2, o teste de carga (`load/checkout-carga.js`) tinha thresholds que
eram "metas de carga" arbitrárias. No Módulo 3 damos o passo conceitual: os
**thresholds do k6 passam a SER os SLOs**. Com isso:

> O teste de carga deixa de perguntar **"funciona?"** e passa a perguntar
> **"funciona DENTRO DO SLO?"**.

O arquivo `load/checkout-slo.js` codifica os três SLOs como thresholds. Se
qualquer um for cruzado, o k6 **encerra com exit code ≠ 0** — o que, num
pipeline, faz o **gate de release reprovar e bloquear a entrega**:

```js
thresholds: {
  // SLO de latência (cauda + típica)
  http_req_duration: ['p(99)<400', 'p(95)<250'],
  // SLO de disponibilidade: 99,5% de sucesso => < 0,5% de erro
  http_req_failed: [{ threshold: 'rate<0.005', abortOnFail: false }],
  // Validações de negócio (200 + total numérico) acima de 99,5%
  checks: ['rate>0.995'],
},
```

Rodar: `npm run slo:load` (ou `BASE_URL=http://localhost:3400 k6 run load/checkout-slo.js`),
com catálogo em `3401` e checkout em `3400`.

---

## 5. Os dois lados, rodados de verdade

Para provar que o teste **de fato reprova** ao violar o SLO, rodamos os dois
cenários subindo os serviços localmente (catálogo `3401`, checkout `3400`).

### 5.1 PASSA — catálogo saudável (exit code 0)

Serviços saudáveis; latência do checkout na casa de poucos ms.

```
  █ THRESHOLDS

    checks
    ✓ 'rate>0.995' rate=100.00%

    http_req_duration
    ✓ 'p(99)<400' p(99)=5.87ms
    ✓ 'p(95)<250' p(95)=4.29ms

    http_req_failed
    ✓ 'rate<0.005' rate=0.00%


  █ TOTAL RESULTS

    checks_total.......: 2730    45.318094/s
    checks_succeeded...: 100.00% 2730 out of 2730
    checks_failed......: 0.00%   0 out of 2730

    ✓ status e 200
    ✓ corpo tem total

    HTTP
    http_req_duration..............: avg=2.66ms min=704µs med=2.5ms max=18.8ms p(90)=3.78ms p(95)=4.29ms
    http_req_failed................: 0.00%  0 out of 1365
    http_reqs......................: 1365   22.659047/s
```

**Exit code: `0`** → todos os SLOs cumpridos, o gate de release **libera**.

### 5.2 FALHA — catálogo degradado com `CHAOS_LATENCY_MS=500` (exit code ≠ 0)

Reiniciamos o catálogo com `CHAOS_LATENCY_MS=500`. Como o caminho padrão do
checkout resolve os 3 itens **sequencialmente** (feature flag `checkoutResiliente`
OFF), cada checkout passa a levar ~1,5 s — **muito acima do SLO de latência**.
O serviço continua respondendo `200` (disponibilidade intacta), mas o **SLO de
latência é violado** e o teste **reprova**:

```
  █ THRESHOLDS

    checks
    ✓ 'rate>0.995' rate=100.00%

    http_req_duration
    ✗ 'p(99)<400' p(99)=1.51s
    ✗ 'p(95)<250' p(95)=1.5s

    http_req_failed
    ✓ 'rate<0.005' rate=0.00%


  █ TOTAL RESULTS

    checks_total.......: 1110    18.035004/s
    checks_succeeded...: 100.00% 1110 out of 1110
    checks_failed......: 0.00%   0 out of 1110

    ✓ status e 200
    ✓ corpo tem total

    HTTP
    http_req_duration..............: avg=1.5s min=1.5s med=1.5s max=1.57s p(90)=1.5s p(95)=1.5s
    http_req_failed................: 0.00%  0 out of 555
    http_reqs......................: 555    9.017502/s

time="..." level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
```

**Exit code: `99`** (≠ 0) → SLO de latência cruzado (linhas `✗` em vermelho no
terminal), o k6 falha e o gate de release **bloqueia a entrega**.

> Observação didática: note que **a disponibilidade continuou 100%** — o serviço
> "funciona". O que reprovou foi o **"funciona dentro do SLO?"**. É exatamente
> essa a diferença que o SLO-driven testing captura e que um teste de carga
> tradicional (só olhando status 200) deixaria passar.

---

## 6. Como o error budget governa o ritmo de entrega

O error budget é um **acordo entre produto e engenharia** que substitui a briga
de "estabilidade × velocidade" por uma regra objetiva:

| Estado do budget | Sinal | Ação no pipeline (gates) |
|------------------|-------|--------------------------|
| **Sobrando** (consumo < previsto) | verde | Acelerar: liberar features, aumentar % do canary, reduzir gates. |
| **Perto do limite** | amarelo | Cautela: canary mais lento, mais observação, revisões extras. |
| **Estourado** (SLO violado) | vermelho | **Congelar features**; só entram correções de confiabilidade; SLO-load como gate obrigatório. |

### 6.1 Conexão com feature flags / canary (Módulo 3)

O canary é **como se gasta o budget com segurança**: ao liberar `checkoutResiliente`
para 5% → 25% → 100%, cada etapa consome um pedaço controlado do budget. Se a
etapa de canary **queima budget rápido** (burn rate alto no SLI de latência/erro),
o **rollback automático** é acionado *antes* de o budget global estourar. A flag é
o botão de reversão; o error budget é o **critério** para apertá-lo.

### 6.2 Conexão com o DORA

Os quatro DORA metrics conversam diretamente com o budget:

- **Deployment Frequency** e **Lead Time**: com budget sobrando, entrega-se mais e
  mais rápido (gates relaxados).
- **Change Failure Rate** e **MTTR**: são exatamente o que **consome** o budget —
  cada deploy ruim gasta orçamento; um MTTR baixo devolve estabilidade e preserva
  o budget. O SLO-load como gate reduz o Change Failure Rate na origem.

O error budget é, portanto, a ponte que transforma DORA (velocidade) e SLO
(confiabilidade) num **único loop de decisão**.

---

## 7. O loop com produção (observabilidade do Módulo 3)

O teste SLO-driven é o **pré-lançamento**; produção é o **julgamento contínuo**:

```
        SLOs definidos (este doc)
                 │
                 ▼
   k6 threshold = SLO  ──►  gate de release (CI)  ──►  deploy via canary/flag
                 ▲                                            │
                 │                                            ▼
   ajusta SLO/meta                              observabilidade mede o SLI real
                 │                              (traces, métricas p95/p99, erros)
                 │                                            │
                 └──────────  error budget / burn rate  ◄─────┘
                              (verde → acelera | vermelho → congela)
```

- A **observabilidade do Módulo 3** (OpenTelemetry: traces distribuídos + métricas
  `qualicart.checkout.duracao`, contadores de checkout) mede o **SLI real em
  produção** — os mesmos p95/p99 que o k6 verifica em pré-lançamento.
- Com o SLI real, calcula-se o **consumo do error budget** e o **burn rate**.
- O burn rate dispara alertas e realimenta a decisão de **acelerar ou congelar** —
  fechando o loop entre teste, entrega e produção.

Assim o SLO deixa de ser um número num slide e vira o **eixo** que alinha teste de
carga, gate de CI, canary/feature flags, DORA e observabilidade.
