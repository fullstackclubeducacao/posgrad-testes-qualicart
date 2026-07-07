# Chaos Engineering — Experimento no QualiCart

> Modulo 2 — Testes e Qualidade. Este documento explica a ideia de Chaos
> Engineering e registra um experimento **real** (com numeros medidos) sobre a
> resiliencia do servico de checkout quando o catalogo degrada.

## 1. O que e Chaos Engineering (e o que NAO e)

Chaos Engineering e a pratica de **injetar falhas controladas em um sistema
para descobrir fragilidades ANTES que elas viram incidente em producao**. A
premissa e simples: sistemas distribuidos falham de formas que ninguem previu
no papel — a rede fica lenta, um servico responde 503, um disco enche. Em vez
de esperar o desastre acontecer de madrugada, nos o provocamos de dia, de forma
pequena e observada.

O ponto central e que **isto e um metodo cientifico, nao vandalismo**. Nao se
trata de "derrubar servidores para ver o que acontece". Todo experimento segue
um ciclo disciplinado:

1. **Estado estavel (baseline)** — defina e meca como e o comportamento
   saudavel do sistema (latencia, taxa de sucesso, throughput). Sem uma linha de
   base, nao ha como afirmar que algo piorou.
2. **Hipotese** — formule, **antes** de injetar a falha, uma previsao explicita
   e falsificavel do que deve acontecer. Ex.: "a latencia deve subir X, mas a
   taxa de erro deve continuar ~0%".
3. **Injecao da falha e medicao** — introduza a falha (latencia, erro,
   indisponibilidade) e meca as mesmas metricas do baseline.
4. **Resultado e aprendizado** — a hipotese se sustentou? O que a diferenca
   entre o esperado e o observado revela sobre a arquitetura? Gere acoes.

### Blast radius (raio de explosao) e adocao progressiva

Duas ideias tornam o chaos seguro:

- **Blast radius minimo**: comece com o menor impacto possivel. Poucas
  requisicoes, um unico servico, ambiente local ou de teste, com um botao de
  "parar" sempre a mao. So depois de aprender com o pequeno voce aumenta a
  escala (mais trafego, staging, e por fim uma fracao controlada de producao).
- **Adocao progressiva**: primeiro rode em dev/local (como neste experimento),
  depois em staging, depois em producao em janelas e percentuais controlados
  (ex.: 1% do trafego). A confianca cresce junto com o raio.

Neste experimento o blast radius e **minimo de proposito**: dois processos Node
locais, em portas dedicadas (3200 e 3201), 50 requisicoes por bateria, e
teardown automatico ao final. Nada toca ambientes reais.

## 2. O sistema sob teste

O QualiCart tem dois servicos que se comunicam por HTTP:

- **Catalogo** (`packages/catalog`) — porta **3201** no experimento. Responde
  precos de produtos. Ja possui **ganchos de injecao de falha** controlados por
  variavel de ambiente (`packages/catalog/src/server.ts`):
  - `CHAOS_LATENCY_MS`: adiciona essa latencia (ms) antes de responder.
  - `CHAOS_FAIL_RATE` (0..1): probabilidade de responder **503**.
- **Checkout** (`packages/checkout`) — porta **3200** no experimento. Ao receber
  `POST /checkout`, ele resolve o preco de **cada item** consultando o catalogo
  por HTTP (`catalog-client.ts` → `checkout-service.ts`) e so entao calcula o
  pedido.

Como o checkout **depende** do catalogo, degradar o catalogo e a forma classica
de reproduzir uma **falha parcial** de sistema distribuido: um servico saudavel
sofre por causa de uma dependencia doente.

O payload usado no experimento tem **2 itens** (`CAM-001` e `CAN-001`) — esse
detalhe sera importante no aprendizado.

## 3. O experimento

Script reproduzivel: **`chaos/experimento-catalogo.mjs`** (com wrapper
**`chaos/experimento-catalogo.sh`**). Ele sobe os dois servicos, roda a bateria
baseline, derruba o catalogo e o reinjeta com chaos, roda a bateria degradada,
imprime o comparativo e **encerra todos os processos** ao final (sem orfaos).

Como reproduzir:

```bash
./chaos/experimento-catalogo.sh
# ou parametrizando:
N_REQ=100 CHAOS_LATENCY_MS=500 CHAOS_FAIL_RATE=0.3 ./chaos/experimento-catalogo.sh
```

### 3.1 Estado estavel (baseline)

Catalogo **saudavel** (sem chaos) na 3201, checkout na 3200. 50 requisicoes
`POST /checkout`. Numeros **reais** medidos:

| Metrica            | Valor      |
| ------------------ | ---------- |
| Requisicoes        | 50         |
| Sucessos (200)     | 50         |
| Taxa de erro       | **0.0%**   |
| Latencia media     | **1.1 ms** |
| Latencia p50       | 0.7 ms     |
| Latencia p95       | 1.7 ms     |
| Latencia max       | 13.7 ms    |

O sistema saudavel e rapido (~1 ms) e 100% confiavel. Essa e a nossa linha de
base.

### 3.2 Hipotese (formulada ANTES da injecao)

Parametros de falha: `CHAOS_LATENCY_MS=300` e `CHAOS_FAIL_RATE=0.5`.

> **H1 (latencia):** se cada resposta do catalogo atrasar 300 ms, a latencia do
> checkout deve subir de forma perceptivel, porque o checkout **espera** o
> catalogo. Como ele consulta **2 itens em sequencia**, o atraso deve se
> **acumular** para ~600 ms.
>
> **H2 (erro):** se o catalogo falhar (503) em ~50% das chamadas e o checkout
> **nao tiver retry/fallback**, a taxa de erro do checkout deve subir muito.
> Como sao 2 itens e **basta um** falhar para derrubar o pedido inteiro, a taxa
> esperada e ainda **maior que 50%** — em torno de `1 - 0.5 * 0.5 = 75%`.

A hipotese ja aposta que o experimento vai **revelar uma fragilidade**: a
ausencia de mecanismos de resiliencia no checkout.

### 3.3 Injecao da falha e medicao

O catalogo saudavel foi derrubado e reinjetado na **mesma porta 3201** com
`CHAOS_LATENCY_MS=300` e `CHAOS_FAIL_RATE=0.5`. Mesma bateria de 50
requisicoes. Numeros **reais** medidos:

| Metrica            | Valor       |
| ------------------ | ----------- |
| Requisicoes        | 50          |
| Sucessos (200)     | 15          |
| Erros              | 35          |
| Taxa de erro       | **70.0%**   |
| Latencia media     | **485.5 ms**|
| Latencia p50       | 605.3 ms    |
| Latencia p95       | 608.2 ms    |
| Latencia max       | 608.8 ms    |
| Status vistos      | `{ "200": 15, "502": 35 }` |

### 3.4 Comparativo baseline vs. chaos (numeros reais)

| Metrica         | Baseline  | Com chaos | Delta            |
| --------------- | --------- | --------- | ---------------- |
| Taxa de erro    | 0.0%      | 70.0%     | **+70 p.p.**     |
| Latencia media  | 1.1 ms    | 485.5 ms  | **+484.4 ms**    |
| Latencia p95    | 1.7 ms    | 608.2 ms  | +606.5 ms        |
| Latencia max    | 13.7 ms   | 608.8 ms  | +595.1 ms        |

## 4. Resultado e aprendizado

**A hipotese se sustentou** — em ambas as partes, e de forma reveladora:

- **H1 (latencia) confirmada e explicada.** A latencia dos checkouts
  bem-sucedidos ficou em ~605 ms (p50), praticamente **o dobro** dos 300 ms
  injetados. Isso confirma que o checkout consulta o catalogo **item a item, em
  sequencia** (um `await` por item no laco de `checkout-service.ts`). Com 2
  itens, dois atrasos de 300 ms se somam. A latencia media (485 ms) ficou abaixo
  dos 605 ms porque as respostas que falharam com 503 retornaram mais cedo
  (~300 ms), puxando a media para baixo.

- **H2 (erro) confirmada — e a fragilidade e clara.** A taxa de erro do checkout
  foi **70%**, bem acima dos 50% de falha do catalogo, exatamente como previsto
  pelo efeito de **falha composta**: com 2 itens e nenhum retry, basta uma das
  duas chamadas falhar para o pedido inteiro virar erro (probabilidade teorica
  ~75%; medimos 70%, dentro da variacao esperada para 50 amostras). O checkout
  simplesmente propaga o 503 do catalogo como um **502** ao cliente, sem
  qualquer tentativa de recuperacao.

**O que o experimento revelou sobre a resiliencia do checkout:**

1. **Nao ha retry.** Uma unica falha transitoria do catalogo (503) vira erro
   definitivo para o cliente. Falhas transitorias sao a norma em rede — deixa-las
   passar direto e desperdicar as chances de sucesso.
2. **Nao ha timeout nem circuit breaker.** Sob 300 ms de latencia o checkout
   simplesmente **espera**. Se a latencia fosse de 30 s, o checkout ficaria
   pendurado 30 s (ou mais, somando itens), segurando conexoes e degradando em
   cascata. Nao existe um limite que corte a espera e proteja o servico.
3. **As chamadas sao sequenciais**, o que faz a latencia crescer **linearmente
   com o numero de itens** do carrinho. Um carrinho com 10 itens pagaria 10x a
   latencia do catalogo.
4. **A falha compoe.** Sem tratamento, a confiabilidade do checkout e o produto
   das confiabilidades de cada chamada — quanto mais itens, pior. O checkout e
   **menos** confiavel que sua dependencia, quando deveria ser **mais**.

### 4.1 Melhorias arquiteturais propostas (a implementar depois)

> Estas propostas **nao** foram implementadas neste experimento — o objetivo aqui
> era descobrir a fragilidade, nao corrigi-la.

1. **Timeout + retry com backoff (e idempotencia) no `catalog-client`.**
   Definir um timeout por chamada (ex.: 500 ms) e tentar novamente 1–2 vezes com
   espera exponencial e jitter para falhas transitorias (503/timeout). Isso
   sozinho derrubaria boa parte dos 70% de erro, ja que muitas falhas do catalogo
   sao intermitentes. Deve vir acompanhado de um **circuit breaker**: se o
   catalogo estiver claramente fora, abrir o circuito e falhar rapido, em vez de
   segurar conexoes e degradar em cascata.

2. **Resolver os itens em paralelo + fallback/cache de precos.** Trocar o laco
   sequencial por `Promise.all` para que a latencia de N itens seja ~a de 1 item,
   e nao N vezes maior. Complementarmente, manter um **cache de precos** (ou uma
   copia local com TTL) que sirva de fallback quando o catalogo estiver
   indisponivel — permitindo concluir o checkout com o ultimo preco conhecido,
   em vez de recusar a venda.

Um proximo experimento (adocao progressiva) seria repetir esta bateria **apos**
implementar timeout+retry e medir a queda real na taxa de erro — fechando o
ciclo cientifico com uma nova hipotese.

## 5. Teardown e seguranca

O script encerra **checkout e catalogo** ao final (e tambem em `SIGINT`/`SIGTERM`
e em caso de erro), garantindo que **nao sobrem processos orfaos** nas portas
3200/3201. As portas foram escolhidas para **nao conflitar** com outros
experimentos que rodam em paralelo no mesmo ambiente.

---

### Anexo — saida real da execucao

```
--- BASELINE (catalogo saudavel) ---
  Sucessos (200): 50
  Taxa de erro..: 0.0%
  Latencia media: 1.1 ms
  Latencia p95..: 1.7 ms

--- COM CHAOS (latencia + 503) ---
  Sucessos (200): 15
  Erros.........: 35
  Taxa de erro..: 70.0%
  Latencia media: 485.5 ms
  Latencia p95..: 608.2 ms
  Status vistos.: {"200":15,"502":35}

  Delta de latencia media (chaos - baseline): 484.4 ms
  Delta de taxa de erro: 70.0 pontos percentuais
```
