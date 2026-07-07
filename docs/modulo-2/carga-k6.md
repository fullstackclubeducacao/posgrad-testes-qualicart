# Teste de carga com k6: ramp-up e leitura por percentil

> Módulo 2 - QualiCart. Como medir o comportamento do `POST /checkout` sob
> pressão, e por que olhar a **média** engana enquanto o **percentil** revela.

## 1. O vocabulário: carga, estresse, spike e soak

Antes de rodar qualquer coisa, precisamos separar tipos de teste de desempenho.
Todos usam a mesma ferramenta (aqui, o [k6](https://k6.io/)), mas mudam o
**perfil de carga** (quantos usuários virtuais, por quanto tempo) e a
**pergunta** que respondem.

| Tipo | Pergunta que responde | Perfil de carga |
|------|-----------------------|-----------------|
| **Carga** (*load*) | "Aguento a carga esperada do dia a dia com boa latência?" | Sobe até a carga alvo, sustenta, desce. |
| **Estresse** (*stress*) | "Onde é o meu ponto de ruptura? O que quebra primeiro?" | Sobe além do esperado até degradar/quebrar. |
| **Pico** (*spike*) | "Sobrevivo a uma enxurrada súbita (Black Friday, viralização)?" | Salto brusco de carga em segundos, depois recua. |
| **Resistência** (*soak*) | "Degrada com o tempo? Tem *memory leak*, conexão vazando?" | Carga moderada sustentada por horas. |

Este documento executa um **teste de carga** com **ramp-up**: em vez de jogar
50 usuários de uma vez, subimos gradualmente. Isso imita o crescimento real do
tráfego e mostra *como a latência evolui conforme a carga cresce* - não só o
valor final.

O perfil que usamos (`options.stages` em `load/checkout-carga.js`):

```
30s subindo 0 -> 50 VUs   (ramp-up)
1m  sustentando 50 VUs    (steady state)
20s descendo 50 -> 0 VUs  (ramp-down)
```

> **VU** = *Virtual User* (usuário virtual): uma "pessoa" simulada que executa a
> função de teste em loop. 50 VUs = 50 clientes disparando checkouts em paralelo.

## 2. Por que a MÉDIA mente

Imagine 100 requisições: 99 responderam em 10ms e 1 travou em 2000ms.

- **Média** = (99×10 + 2000) / 100 ≈ **30ms**. Parece ótimo!
- Mas **1 em cada 100 usuários** esperou **2 segundos**. Se você tem 1 milhão
  de requisições/dia, são **10 mil pessoas** com experiência ruim - invisíveis
  na média.

A média é uma medida de tendência central: um único número lento a puxa pouco,
e um único número rápido a mascara. Ela **esconde a cauda** (os *outliers*
lentos), que é justamente onde mora a dor do usuário.

## 3. Por que o PERCENTIL (p95/p99) importa

Um **percentil** responde: "abaixo de qual valor ficam X% das requisições?"

- **p95 = 500ms** significa: **95%** das requisições foram **mais rápidas** que
  500ms; os 5% mais lentos passaram disso.
- **p99 = 800ms**: 99% ficaram abaixo de 800ms; só o 1% pior (a cauda) passou.

O percentil **não pode ser mascarado por outliers** da forma que a média é: ele
descreve a experiência de uma fração concreta dos usuários. Por isso a indústria
define metas em **p95/p99** (às vezes p99.9), não em média:

- **p95** cobre o usuário típico "no pior dia".
- **p99** cobre a cauda - onde estão timeouts, *garbage collection*, contenção
  de conexão com o catálogo, etc.

> Regra prática: **meça a cauda, não o centro.** O usuário que abandona o
> carrinho é o da cauda, não o da média.

## 4. A meta de latência (threshold) definida

No k6, metas viram `options.thresholds`. Se qualquer uma estourar, o processo
sai com código de erro - o que permite **quebrar o pipeline de CI** quando o
desempenho regride. As metas escolhidas para o `/checkout`:

```js
thresholds: {
  http_req_duration: ['p(95)<500', 'p(99)<800'], // p95 < 500ms, p99 < 800ms
  checks: ['rate>0.99'],                          // >99% das validacoes ok
  http_req_failed: ['rate<0.01'],                 // <1% de erros HTTP
}
```

O ponto pedagógico é a **meta por percentil**, não o número em si: cada serviço
calibra seus alvos conforme o que promete ao usuário.

## 5. O sumário REAL do k6

Executado localmente contra checkout (porta 3100) + catálogo (porta 3101),
`node v26`, macOS. Corpo: 3 itens válidos (`CAM-001`, `CAN-001`, `LIV-001`).
Cada VU tem `sleep(1)` de *think time*.

```
  █ THRESHOLDS

    checks
    ✓ 'rate>0.99' rate=100.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=3.35ms
    ✓ 'p(99)<800' p(99)=5.1ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 8550    77.47/s
    checks_succeeded...: 100.00% 8550 out of 8550
    checks_failed......: 0.00%   0 out of 8550

    ✓ status e 200
    ✓ corpo tem total

    HTTP
    http_req_duration..: avg=2.09ms min=469µs med=1.92ms max=21.2ms p(90)=3.03ms p(95)=3.35ms
    http_req_failed....: 0.00%  0 out of 4275
    http_reqs..........: 4275   38.74/s

    EXECUTION
    iterations.........: 4275   38.74/s
    vus................: 1      min=1  max=50
    vus_max............: 50

    NETWORK
    data_received......: 2.5 MB 22 kB/s
    data_sent..........: 1.5 MB 13 kB/s
```

### Leitura dos números que importam

| Métrica | Valor | Meta | Resultado |
|---------|-------|------|-----------|
| **avg** (média) | 2.09ms | - | referência |
| **p95** | **3.35ms** | < 500ms | ✅ passou |
| **p99** | **5.1ms** | < 800ms | ✅ passou |
| max | 21.2ms | - | maior *outlier* |
| checks | 100.00% | > 99% | ✅ passou |
| http_req_failed | 0.00% | < 1% | ✅ passou |
| iterations | 4275 | - | 4275 checkouts completos |

Repare no espaço entre **avg (2.09ms)** e **max (21.2ms)**: a média sozinha
esconderia esse pico de ~10x. O p95/p99 mostra que a **cauda continua saudável**
(5.1ms), o que é a informação que realmente decide se o serviço está bom.

**Resultado geral: todos os thresholds passaram.** O ambiente local é modesto e
sem I/O de banco real (catálogo em memória), por isso as latências são muito
baixas; num ambiente parecido com produção os números subiriam, mas a *forma de
ler* (por percentil, contra uma meta) é idêntica.

## 6. Gancho para o Módulo 3: de threshold a SLO

O que definimos aqui como `threshold` é, na prática, um **SLI** (*Service Level
Indicator*, o que você mede) com um **alvo**. Formalizar isso vira um **SLO**
(*Service Level Objective*, a meta acordada):

> **SLO de exemplo:** 99% das requisições de `/checkout` respondem em menos de
> 800ms, medido em janelas de 30 dias.

A partir do SLO nasce o **error budget** (orçamento de erro): se o alvo é 99%,
você "pode gastar" 1% fora da meta antes de acionar alertas ou frear entregas.
E o **SLA** (*Agreement*) é o SLO com consequência contratual. O teste de carga
por percentil é a ferramenta que **valida se o SLO é factível** antes de
prometê-lo. Aprofundamos SLI/SLO/SLA e *error budget* no **Módulo 3**.

## 7. Alertas operacionais (leia antes de rodar "pra valer")

- **Rode contra um ambiente parecido com produção.** Latência em `localhost`
  sem banco real (como aqui) é otimista demais. Meça em *staging* com dados,
  rede, réplicas e recursos equivalentes - senão o número não significa nada.
- **Não faça estresse sério em produção sem plano.** Um teste de estresse/spike
  pode derrubar o serviço para usuários reais, disparar *auto-scaling* caro ou
  poluir métricas e alertas. Se for testar em produção, faça com janela
  combinada, *kill switch*, monitoramento ao vivo e comunicação ao time.
- **Isole a variável.** Rode um cenário por vez e mantenha o ambiente estável;
  senão você não sabe se a latência veio do seu código ou de vizinhos barulhentos.
- **Guarde histórico.** Compare execuções ao longo do tempo para pegar
  **regressão de desempenho** cedo - de preferência, com o threshold quebrando o
  CI automaticamente.

## Como reproduzir

```bash
# 1. Suba o catálogo (porta 3101)
CATALOG_PORT=3101 node packages/catalog/src/server.ts &

# 2. Suba o checkout (porta 3100) apontando para o catálogo
PORT=3100 CATALOG_URL=http://localhost:3101 node packages/checkout/src/server.ts &

# 3. Rode a carga
k6 run load/checkout-carga.js
# ou com host alternativo:
BASE_URL=http://localhost:3100 k6 run load/checkout-carga.js

# 4. Derrube os servidores ao final
lsof -ti:3100 | xargs kill -9
lsof -ti:3101 | xargs kill -9
```

Script: [`load/checkout-carga.js`](../../load/checkout-carga.js).
