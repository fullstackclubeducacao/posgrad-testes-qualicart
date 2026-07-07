// Instrumentacao OpenTelemetry do servico de CHECKOUT.
//
// Este arquivo DEVE ser carregado ANTES do codigo do servico, via a flag
// `node --import ./packages/checkout/src/instrumentation.ts`. Assim o SDK
// registra os hooks de instrumentacao automatica (HTTP servidor + cliente
// fetch/undici) antes de qualquer `import` de `node:http`/`undici` acontecer.
//
// ABORDAGEM (importante): sob Node nativo com ESM + type stripping, a
// instrumentacao AUTOMATICA de `node:http` (servidor) NAO engancha de forma
// confiavel (o patch via require-in-the-middle nao intercepta o modulo core em
// ESM nativo). Por isso, adotamos SPANS MANUAIS explicitos no `server.ts` e no
// `catalog-client.ts`, com propagacao W3C `traceparent` manual entre os
// servicos. O NodeSDK ainda e essencial: ele registra o context manager
// (async hooks), o propagador W3C e o pipeline de export de spans/metricas.
//
// O que este arquivo faz:
// - Cria um NodeSDK com resource (service.name), exportador de spans e o
//   pipeline de metricas. Mantemos `getNodeAutoInstrumentations()` apenas com
//   as instrumentacoes ruidosas desligadas (a de HTTP/undici e substituida
//   pelos spans manuais para evitar spans duplicados/orfaos).
// - Exporta spans para o console por padrao (texto capturavel). Se
//   OTEL_EXPORTER_OTLP_ENDPOINT estiver definido, usa o exporter OTLP HTTP
//   (para enviar a um Jaeger/collector).
// - Exporta uma metrica (contador + histograma de checkout) para o console
//   (ou OTLP, se configurado).

import { NodeSDK, tracing, metrics, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const SERVICE_NAME = 'qualicart-checkout';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const traceExporter = otlpEndpoint
  ? new OTLPTraceExporter()
  : new tracing.ConsoleSpanExporter();

// Metricas: por simplicidade e para o trace ser legivel, exportamos ao console
// periodicamente (e no shutdown). Em producao, trocar por OTLP.
const metricReader = new metrics.PeriodicExportingMetricReader({
  exporter: new metrics.ConsoleMetricExporter(),
  exportIntervalMillis: 15_000,
});

const sdk = new NodeSDK({
  resource: resources.resourceFromAttributes({
    'service.name': SERVICE_NAME,
  }),
  // SimpleSpanProcessor: emite cada span assim que termina -> saida imediata no
  // console (ideal para capturar o trace em texto durante o experimento).
  spanProcessors: [new tracing.SimpleSpanProcessor(traceExporter)],
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Ruido/duplicidade: usamos spans manuais para HTTP.
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-undici': { enabled: false },
      '@opentelemetry/instrumentation-http': { enabled: false },
      '@opentelemetry/instrumentation-runtime-node': { enabled: false },
    }),
  ],
});

sdk.start();
console.log(`[otel] instrumentacao iniciada para ${SERVICE_NAME}`);

const encerrar = (): void => {
  sdk
    .shutdown()
    .catch((erro: unknown) => console.error('[otel] erro no shutdown', erro))
    .finally(() => process.exit(0));
};

process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
