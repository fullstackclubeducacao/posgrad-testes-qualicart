// Servico de catalogo/precos, usando apenas modulos nativos do Node.

import http from 'node:http';
import {
  trace,
  context,
  propagation,
  SpanKind,
  type Span,
} from '@opentelemetry/api';
import { buscarProduto, listarProdutos } from './products.ts';

const PORT = Number(process.env.CATALOG_PORT ?? 3001);

// Tracer manual: extraimos o `traceparent` W3C que o checkout enviou e abrimos
// um span SERVER filho, continuando o MESMO trace (trace distribuido).
const tracer = trace.getTracer('qualicart-catalog');

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown): void {
  const payload = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Injecao de falha para o experimento de CHAOS (Modulo 2).
 *
 * Controlada por variaveis de ambiente, para nao afetar o comportamento normal:
 * - CHAOS_LATENCY_MS: adiciona latencia (em ms) antes de responder.
 * - CHAOS_FAIL_RATE (0..1): probabilidade de responder 503 (indisponivel).
 *
 * Retorna `true` se a requisicao ja foi respondida com falha (o chamador deve
 * encerrar o fluxo). Sem essas envs, comportamento normal.
 */
async function aplicarChaos(res: http.ServerResponse): Promise<boolean> {
  const latencia = process.env.CHAOS_LATENCY_MS;
  if (latencia !== undefined) {
    await dormir(Number(latencia));
  }

  const taxaFalha = process.env.CHAOS_FAIL_RATE;
  if (taxaFalha !== undefined && Math.random() < Number(taxaFalha)) {
    enviarJson(res, 503, { erro: 'indisponivel' });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/health') {
    enviarJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && (url === '/produtos' || url.startsWith('/produtos/'))) {
    // Continua o trace do checkout: extrai o contexto W3C dos headers e abre um
    // span SERVER filho. O `await aplicarChaos` (latencia do experimento) fica
    // DENTRO do span, entao a duracao capturada mostra o gargalo.
    const parentCtx = propagation.extract(context.active(), req.headers);
    await context.with(parentCtx, () =>
      tracer.startActiveSpan(
        url === '/produtos' ? 'GET /produtos' : 'GET /produtos/:sku',
        { kind: SpanKind.SERVER },
        async (span: Span) => {
          span.setAttribute('http.request.method', 'GET');
          span.setAttribute('url.path', url);
          try {
            if (await aplicarChaos(res)) return;

            if (url === '/produtos') {
              enviarJson(res, 200, listarProdutos());
              return;
            }

            const sku = decodeURIComponent(url.slice('/produtos/'.length));
            span.setAttribute('catalog.sku', sku);
            const produto = buscarProduto(sku);
            if (produto === undefined) {
              span.setAttribute('http.response.status_code', 404);
              enviarJson(res, 404, { erro: `Produto ${sku} nao encontrado` });
              return;
            }
            span.setAttribute('http.response.status_code', 200);
            enviarJson(res, 200, produto);
          } finally {
            span.end();
          }
        },
      ),
    );
    return;
  }

  enviarJson(res, 404, { erro: 'Rota nao encontrada' });
});

server.listen(PORT, () => {
  console.log(`Catalogo rodando em http://localhost:${PORT}`);
});
