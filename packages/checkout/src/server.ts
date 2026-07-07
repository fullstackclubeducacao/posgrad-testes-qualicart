// Servidor HTTP do QualiCart (servico de checkout), usando modulos nativos.
//
// Agora o checkout consome o servico de catalogo por HTTP para resolver precos
// (via checkout-service) e persiste o pedido num PedidoRepository.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { finalizarCheckout } from './checkout-service.ts';
import { PedidoRepositoryMemoria } from './pedido-repository.ts';
import { ProdutoNaoEncontradoError } from './catalog-client.ts';
import type { CheckoutInput } from './checkout-service.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT ?? 3000);

const repo = new PedidoRepositoryMemoria();

function lerCorpo(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => {
      dados += chunk;
    });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown): void {
  const payload = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function servirIndex(res: http.ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('index.html nao encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    await servirIndex(res);
    return;
  }

  if (req.method === 'POST' && req.url === '/checkout') {
    const bruto = await lerCorpo(req);

    let corpo: CheckoutInput;
    try {
      corpo = JSON.parse(bruto) as CheckoutInput;
    } catch {
      enviarJson(res, 400, { erro: 'JSON invalido' });
      return;
    }

    try {
      const pedido = await finalizarCheckout(
        {
          itens: corpo.itens ?? [],
          cupom: corpo.cupom ?? null,
          cep: corpo.cep ?? '',
          nomeCliente: corpo.nomeCliente ?? '',
          emailCliente: corpo.emailCliente ?? '',
          freteGratisVip: corpo.freteGratisVip ?? false,
          observacao: corpo.observacao ?? '',
        },
        repo,
      );
      enviarJson(res, 200, pedido);
    } catch (erro) {
      if (erro instanceof ProdutoNaoEncontradoError) {
        enviarJson(res, 422, { erro: erro.message });
        return;
      }
      enviarJson(res, 502, { erro: 'Falha ao consultar o catalogo' });
    }
    return;
  }

  enviarJson(res, 404, { erro: 'Rota nao encontrada' });
});

server.listen(PORT, () => {
  console.log(`Checkout rodando em http://localhost:${PORT}`);
});
