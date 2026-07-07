// Servico de catalogo/precos, usando apenas modulos nativos do Node.

import http from 'node:http';
import { buscarProduto, listarProdutos } from './products.ts';

const PORT = Number(process.env.CATALOG_PORT ?? 3001);

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

  if (req.method === 'GET' && url === '/produtos') {
    if (await aplicarChaos(res)) return;
    enviarJson(res, 200, listarProdutos());
    return;
  }

  if (req.method === 'GET' && url.startsWith('/produtos/')) {
    if (await aplicarChaos(res)) return;
    const sku = decodeURIComponent(url.slice('/produtos/'.length));
    const produto = buscarProduto(sku);
    if (produto === undefined) {
      enviarJson(res, 404, { erro: `Produto ${sku} nao encontrado` });
      return;
    }
    enviarJson(res, 200, produto);
    return;
  }

  enviarJson(res, 404, { erro: 'Rota nao encontrada' });
});

server.listen(PORT, () => {
  console.log(`Catalogo rodando em http://localhost:${PORT}`);
});
