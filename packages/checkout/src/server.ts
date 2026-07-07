// Servidor HTTP do QualiCart, usando apenas modulos nativos do Node.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { processarCheckout } from './checkout.ts';
import type { ItemCarrinho } from './cart.ts';
import type { Cupom } from './coupon.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT ?? 3000);

type CorpoCheckout = {
  itens?: ItemCarrinho[];
  cupom?: Cupom | null;
  cep?: string;
  nomeCliente?: string;
  emailCliente?: string;
  freteGratisVip?: boolean;
  observacao?: string;
};

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

    let corpo: CorpoCheckout;
    try {
      corpo = JSON.parse(bruto) as CorpoCheckout;
    } catch {
      enviarJson(res, 400, { erro: 'JSON invalido' });
      return;
    }

    const resultado = processarCheckout(
      corpo.itens ?? [],
      corpo.cupom ?? null,
      corpo.cep ?? '',
      corpo.nomeCliente ?? '',
      corpo.emailCliente ?? '',
      corpo.freteGratisVip ?? false,
      corpo.observacao ?? '',
    );

    enviarJson(res, 200, resultado);
    return;
  }

  enviarJson(res, 404, { erro: 'Rota nao encontrada' });
});

server.listen(PORT, () => {
  console.log(`QualiCart rodando em http://localhost:${PORT}`);
});
