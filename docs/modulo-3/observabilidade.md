# Observabilidade com OpenTelemetry (Módulo 3, item 4)

Este documento mostra como o QualiCart foi instrumentado com **OpenTelemetry
(OTel)** para produzir um **trace distribuído** de uma requisição de checkout
atravessando os dois serviços (`checkout` → `catalog`), com a duração de cada
etapa (span), de modo a **localizar o gargalo** de forma inequívoca.

---

## 1. Monitoramento vs. Observabilidade

- **Monitoramento** responde perguntas que você **já sabia** que ia fazer. São
  dashboards e alertas sobre métricas pré-definidas ("a CPU passou de 80%?", "a
  taxa de erro subiu?"). É reativo e limitado às perguntas antecipadas.
- **Observabilidade** é a propriedade de conseguir **responder perguntas novas**
  sobre o sistema **sem precisar fazer novo deploy**, a partir do que ele já
  emite. Diante de "por que ESTE checkout demorou 628 ms?", você consegue abrir
  os dados e navegar até a causa, mesmo sem ter previsto a pergunta.

Monitoramento diz **que** algo está errado; observabilidade ajuda a descobrir
**por quê**. Um sistema distribuído (vários serviços por HTTP) é praticamente
opaco sem observabilidade: a latência total é a soma de saltos entre processos
que os logs isolados de cada serviço não conseguem correlacionar.

## 2. Os três pilares

| Pilar | O que é | Pergunta que responde | No QualiCart |
|-------|---------|-----------------------|--------------|
| **Logs** | Eventos discretos com contexto textual | "O que aconteceu neste instante?" | `console.log` do servidor |
| **Métricas** | Agregados numéricos ao longo do tempo (contadores, histogramas) | "Qual a tendência/volume/percentil?" | `qualicart.checkouts.processados` (contador) e `qualicart.checkout.duracao` (histograma) |
| **Traces** | A jornada completa de UMA requisição, quebrada em spans aninhados com duração, atravessando serviços | "Onde o tempo foi gasto nesta requisição específica?" | trace `POST /checkout` → 2× `GET /produtos/:sku` (checkout + catálogo) |

Os três se complementam: a **métrica** de duração dispara o alerta ("p99 do
checkout piorou"), o **trace** localiza o span lento, e os **logs** daquele span
detalham o erro.

## 3. OpenTelemetry como padrão

OpenTelemetry é o **padrão aberto** (CNCF) para instrumentação: uma única API/SDK
para gerar logs, métricas e traces, e um formato de fio (**OTLP**) e uma
convenção de propagação de contexto (**W3C `traceparent`**) independentes de
fornecedor. Você instrumenta uma vez e escolhe o backend depois — Jaeger, Tempo,
Datadog, Honeycomb etc. — sem reescrever a aplicação. Isso evita *lock-in* e é
por isso que virou o padrão de fato do mercado.

## 4. Por que o trace é indispensável no distribuído

No QualiCart, o `checkout` (porta 3000) chama o `catalog` (porta 3001) por HTTP,
uma vez para cada item do carrinho. Se o checkout está lento, olhar só os logs do
checkout não diz **se** a lentidão está nele ou no catálogo, nem **qual** das
chamadas ao catálogo pesou. O trace resolve isso: cada serviço cria seus spans e
propaga o **mesmo `traceId`** via o header W3C `traceparent`. O resultado é uma
árvore única, com durações por span, onde o gargalo salta aos olhos.

## 5. Como foi instrumentado (abordagem adotada)

### Carregamento antes do app (`--import`)

A instrumentação precisa inicializar **antes** de qualquer `import` do código do
serviço. Isso é feito com a flag nativa do Node `--import`, apontando para o
arquivo de instrumentação de cada serviço. Scripts em `package.json`:

```jsonc
"start":          "node --import ./packages/checkout/src/instrumentation.ts packages/checkout/src/server.ts",
"start:catalog":  "node --import ./packages/catalog/src/instrumentation.ts  packages/catalog/src/server.ts",
"start:checkout": "node --import ./packages/checkout/src/instrumentation.ts packages/checkout/src/server.ts"
```

Cada serviço tem um `instrumentation.ts` que sobe um `NodeSDK`
(`@opentelemetry/sdk-node`) com:

- **`resource` / `service.name`**: `qualicart-checkout` e `qualicart-catalog`.
- **Exporter de spans**: por padrão um **`ConsoleSpanExporter`** (trace legível em
  texto, capturável no terminal). Se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver
  definido, usa o **`OTLPTraceExporter`** (HTTP) para enviar a um Jaeger/collector.
- **Métricas**: `PeriodicExportingMetricReader` + `ConsoleMetricExporter`.
- **Context manager (async hooks)** e **propagador W3C** registrados pelo SDK — é o
  que faz o `traceparent` cruzar os processos e os spans se aninharem através de
  `await`.
- `getNodeAutoInstrumentations()` presente, porém com as instrumentações ruidosas
  desativadas (ver abaixo).

### Auto vs. manual — o que foi escolhido e por quê

Tentei primeiro a **instrumentação automática** de HTTP. Sob **Node nativo com
ESM + *type stripping*** (Node 26, sem build), o patch do módulo *core* `node:http`
(feito via *require-in-the-middle*) **não engancha de forma confiável**: no teste,
o servidor não gerou span de request e cada `fetch` virou um **trace-raiz
separado**, sem `traceId` comum — ou seja, **não havia trace distribuído** e o
catálogo produziu **zero spans**.

Por isso, a abordagem adotada é de **spans manuais explícitos** com propagação
W3C manual, que é determinística e independe do funcionamento do *monkey-patch* de
módulos core em ESM:

- **`checkout/src/server.ts`** — abre o span **raiz** `POST /checkout`
  (`SpanKind.SERVER`) via `tracer.startActiveSpan(...)`; tudo o que roda dentro
  (inclusive os spans do cliente) fica aninhado. Também registra as métricas.
- **`checkout/src/catalog-client.ts`** — para cada produto, abre um span
  `GET /produtos/:sku` (`SpanKind.CLIENT`) e faz `propagation.inject(...)` para
  gravar o header `traceparent` no `fetch`.
- **`catalog/src/server.ts`** — faz `propagation.extract(...)` dos headers do
  request e abre um span `GET /produtos/:sku` (`SpanKind.SERVER`) **filho** do span
  cliente do checkout. A latência de *chaos* fica **dentro** do span, então a
  duração medida reflete o gargalo real.

Nenhuma **regra de negócio** foi alterada — só foram adicionados spans/métricas
em volta do fluxo existente (os testes de unidade seguem verdes).

### Métrica

O checkout expõe duas métricas (via a API de métricas do OTel, exportadas ao
console/OTLP):

- `qualicart.checkouts.processados` — **contador** de checkouts finalizados
  (atributo `resultado = ok | erro`).
- `qualicart.checkout.duracao` — **histograma** da duração do checkout em ms.

Saída real (flush no shutdown) da execução capturada abaixo:

```text
name: 'qualicart.checkouts.processados', type: 'COUNTER'
  dataPoints: [ { attributes: { resultado: 'ok' }, value: 1 } ]

name: 'qualicart.checkout.duracao', type: 'HISTOGRAM', unit: 'ms'
  dataPoints: [ { attributes: { resultado: 'ok' },
                  value: { min: 627.94, max: 627.94, sum: 627.94 } } ]
```

---

## 6. Trace REAL capturado (mostrando o gargalo)

Reprodução do experimento (catálogo com `CHAOS_LATENCY_MS=300` para criar um
gargalo visível):

```bash
# Terminal A — catálogo com 300 ms de latência injetada por requisição
CHAOS_LATENCY_MS=300 npm run start:catalog

# Terminal B — checkout
npm run start:checkout

# Terminal C — checkout com 2 itens
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{"itens":[{"sku":"CAM-001","quantidade":2},{"sku":"CAN-001","quantidade":1}],"cep":"01001000","nomeCliente":"Ana","emailCliente":"ana@x.com"}'
```

Todos os spans dos **dois serviços** compartilham o mesmo
**`traceId = 26ec4552cde3d848aba2c7fe05be660f`**. Montando a árvore pelos
`id`/`parentSpanId`:

```text
traceId 26ec4552cde3d848aba2c7fe05be660f

POST /checkout                     [qualicart-checkout · SERVER]  id=2820c3db04a14e81  raiz     ── 628.3 ms
├─ GET /produtos/:sku (CAM-001)    [qualicart-checkout · CLIENT]  id=f3aa6cd4dfb457dc           ── 320.5 ms
│   └─ GET /produtos/:sku          [qualicart-catalog  · SERVER]  id=537fe2774ba88b58           ── 304.5 ms   ◀── GARGALO (chaos 300 ms)
└─ GET /produtos/:sku (CAN-001)    [qualicart-checkout · CLIENT]  id=fa1d3be46091c18c           ── 303.9 ms
    └─ GET /produtos/:sku          [qualicart-catalog  · SERVER]  id=41d9da8dca022958           ── 301.6 ms   ◀── GARGALO (chaos 300 ms)
```

### Onde está o gargalo

- O request total (`POST /checkout`) levou **628.3 ms**.
- Esse tempo é essencialmente a **soma das duas chamadas sequenciais ao catálogo**
  (320.5 ms + 303.9 ms ≈ 624 ms). Os spans do **catálogo** (`SERVER`, ~304 e
  ~302 ms) consomem quase toda a duração de cada chamada cliente.
- A **lógica pura do checkout** (`processarCheckout`: carrinho, cupom, frete) é
  **sub-milissegundo** — some entre os spans, sem contribuição relevante.

Conclusão do trace: **o gargalo NÃO está na lógica do checkout, e sim nas chamadas
HTTP ao serviço de catálogo** (aqui, a latência injetada de 300 ms por item). O
trace ainda evidencia uma **oportunidade de otimização**: as duas chamadas são
**sequenciais**; paralelizá-las (`Promise.all`) derrubaria o total de ~628 ms para
~320 ms. (Essa mudança é de negócio/performance e foge do escopo desta tarefa de
instrumentação.)

### Spans reais (saída verbatim do `ConsoleSpanExporter`)

Span raiz no serviço de checkout:

```text
  traceId: '26ec4552cde3d848aba2c7fe05be660f',
  parentSpanContext: undefined,
  name: 'POST /checkout',
  id: '2820c3db04a14e81',
  kind: 1,                       // SERVER
  duration: 628272.625,          // microssegundos -> 628.3 ms
  attributes: { 'checkout.itens': 2, 'checkout.total': 174.7 },
  resource: { 'service.name': 'qualicart-checkout' }
```

Span do catálogo (outro processo, MESMO trace — note `isRemote: true`, prova da
propagação do `traceparent` entre serviços):

```text
  traceId: '26ec4552cde3d848aba2c7fe05be660f',
  parentSpanContext: {
    traceId: '26ec4552cde3d848aba2c7fe05be660f',
    spanId: 'f3aa6cd4dfb457dc',   // = span CLIENT do checkout (CAM-001)
    traceFlags: 1,
    isRemote: true
  },
  name: 'GET /produtos/:sku',
  id: '537fe2774ba88b58',
  kind: 1,                        // SERVER
  duration: 304466.792,           // -> 304.5 ms  (o gargalo)
  attributes: {
    'http.request.method': 'GET',
    'url.path': '/produtos/CAM-001',
    'catalog.sku': 'CAM-001',
    'http.response.status_code': 200
  },
  resource: { 'service.name': 'qualicart-catalog' }
```

---

## 7. Instrumentar faz parte da "Definição de Pronto" (DoR/DoD)

Uma funcionalidade **não está pronta** só porque "passa nos testes". Se, em
produção, não dá para responder *"esta requisição está lenta/quebrada — por quê?"*,
a entrega está incompleta. Por isso, instrumentar deve constar na **Definition of
Done**:

- Todo endpoint/handler novo emite um **span** (com atributos úteis) e propaga o
  contexto para os serviços que chama.
- Fluxos de negócio relevantes expõem ao menos uma **métrica** (contador de
  volume e/ou histograma de latência) para alimentar dashboards e alertas de SLO.
- Erros marcam o span com `SpanStatusCode.ERROR` (correlação log ↔ trace).

Tratar observabilidade como cidadã de primeira classe — junto com testes — é o
que permite operar o sistema com confiança e diagnosticar incidentes em minutos,
não em horas.

---

## 8. (Opcional) Ver os traces no Jaeger

Por padrão os spans vão para o **console**. Para visualizá-los numa UI de trace,
suba um Jaeger *all-in-one* (com endpoint OTLP habilitado) e aponte os serviços a
ele via `OTEL_EXPORTER_OTLP_ENDPOINT` — **não é necessário** para a validação
acima, é só para explorar visualmente.

```bash
# 1) Jaeger all-in-one (UI em http://localhost:16686, OTLP/HTTP em 4318)
docker run --rm --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# 2) Suba os serviços apontando o exporter OTLP para o Jaeger
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 CHAOS_LATENCY_MS=300 npm run start:catalog
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run start:checkout

# 3) Faça o POST /checkout e abra http://localhost:16686
#    -> selecione o serviço "qualicart-checkout" e veja a árvore de spans,
#       com o span do catálogo como gargalo.
```
