// Instrumentacao OpenTelemetry do servico de CATALOGO.
//
// Carregado via `node --import ./packages/catalog/src/instrumentation.ts`.
//
// Como no checkout, sob Node nativo (ESM + type stripping) a instrumentacao
// automatica de `node:http` servidor nao engancha; o `server.ts` extrai o
// `traceparent` W3C manualmente do request e abre um span SERVER, de modo que
// o request GET /produtos/:sku faz parte do MESMO trace do checkout (trace
// distribuido). O NodeSDK registra o context manager, o propagador W3C e o
// pipeline de export de spans/metricas.

import { NodeSDK, tracing, metrics, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const SERVICE_NAME = 'qualicart-catalog';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const traceExporter = otlpEndpoint
  ? new OTLPTraceExporter()
  : new tracing.ConsoleSpanExporter();

const metricReader = new metrics.PeriodicExportingMetricReader({
  exporter: new metrics.ConsoleMetricExporter(),
  exportIntervalMillis: 15_000,
});

const sdk = new NodeSDK({
  resource: resources.resourceFromAttributes({
    'service.name': SERVICE_NAME,
  }),
  spanProcessors: [new tracing.SimpleSpanProcessor(traceExporter)],
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-http': { enabled: false },
      '@opentelemetry/instrumentation-undici': { enabled: false },
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
