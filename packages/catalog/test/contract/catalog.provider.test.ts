// Verificacao do PROVEDOR contra o pact gerado pelo consumidor (checkout).
//
// Sobe o servico de catalogo real num porto dedicado (3021, controlado por
// este teste para evitar conflito com outros agentes/servidores) e usa o
// Verifier do Pact para replayar cada interacao do arquivo committed em
// `pacts/` contra o provedor de verdade. Se a forma da resposta divergir do
// contrato, a verificacao falha.
//
// Le o pact do ARQUIVO em `pacts/` (pactUrls), portanto nao depende da ordem
// de execucao com o teste do consumidor.

import { test, before, after } from 'node:test';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Verifier } from '@pact-foundation/pact';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(aqui, '../../../..');
const PACT_FILE = path.join(RAIZ, 'pacts', 'qualicart-checkout-qualicart-catalog.json');
const SERVER_ENTRY = path.join(RAIZ, 'packages', 'catalog', 'src', 'server.ts');

const PORTA = 3021;
const BASE_URL = `http://localhost:${PORTA}`;

let servidor: ChildProcess;

async function esperarHealth(url: string, tentativas = 50): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Catalogo nao respondeu em ${url}/health a tempo`);
}

before(async () => {
  servidor = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, CATALOG_PORT: String(PORTA) },
    stdio: 'ignore',
  });
  await esperarHealth(BASE_URL);
});

after(() => {
  if (servidor && !servidor.killed) {
    servidor.kill('SIGKILL');
  }
});

test('o provedor de catalogo satisfaz o contrato do checkout', async () => {
  const verifier = new Verifier({
    provider: 'qualicart-catalog',
    providerBaseUrl: BASE_URL,
    pactUrls: [PACT_FILE],
  });

  const saida = await verifier.verifyProvider();
  // verifyProvider() rejeita a Promise em caso de falha; chegar aqui = verde.
  console.log('Verificacao do provedor concluida:', saida);
});
