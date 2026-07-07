#!/usr/bin/env node
// Comparativo canary: checkout com a flag `checkoutResiliente` OFF vs ON,
// ambos sob o MESMO catalogo degradado (latencia + 503).
// Portas dedicadas 3300/3301. Teardown garantido. NAO altera o script committed.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const PORTA_CATALOGO = 3301;
const PORTA_CHECKOUT = 3300;
const URL_CHECKOUT = `http://localhost:${PORTA_CHECKOUT}`;
const URL_CATALOGO = `http://localhost:${PORTA_CATALOGO}`;

const N = Number(process.env.N_REQ ?? 40);
const CHAOS_LATENCY_MS = Number(process.env.CHAOS_LATENCY_MS ?? 300);
const CHAOS_FAIL_RATE = Number(process.env.CHAOS_FAIL_RATE ?? 0.5);

const PAYLOAD = JSON.stringify({
  itens: [
    { sku: 'CAM-001', quantidade: 2 },
    { sku: 'CAN-001', quantidade: 1 },
  ],
  cep: '01000-000',
  emailCliente: 'chaos@qualicart.dev',
});

const procs = new Set();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function subir(arquivo, env) {
  const f = spawn('node', [arquivo], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  procs.add(f);
  f.on('exit', () => procs.delete(f));
  return f;
}

async function esperar(url) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(url).catch(() => fetch(`${url}/health`));
      if (r && r.status > 0) return;
    } catch { /* subindo */ }
    await dormir(200);
  }
  throw new Error(`${url} nao subiu`);
}

function matar(f) {
  return new Promise((resolve) => {
    if (!f || f.exitCode !== null) return resolve();
    f.once('exit', () => resolve());
    f.kill('SIGTERM');
    setTimeout(() => f.exitCode === null && f.kill('SIGKILL'), 2000);
  });
}

function pct(ord, p) {
  if (!ord.length) return 0;
  return ord[Math.max(0, Math.ceil((p / 100) * ord.length) - 1)];
}

async function bateria(rotulo) {
  const lat = [];
  const status = {};
  let ok = 0;
  for (let i = 0; i < N; i += 1) {
    const t = performance.now();
    let s = 0;
    try {
      const r = await fetch(`${URL_CHECKOUT}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: PAYLOAD,
      });
      s = r.status;
      await r.text();
    } catch { s = -1; }
    lat.push(performance.now() - t);
    status[s] = (status[s] ?? 0) + 1;
    if (s === 200) ok += 1;
  }
  const ord = [...lat].sort((a, b) => a - b);
  const media = lat.reduce((a, b) => a + b, 0) / lat.length;
  const r = {
    rotulo, total: N, sucessos: ok, erros: N - ok,
    taxaErro: ((N - ok) / N) * 100, latMedia: media,
    latP50: pct(ord, 50), latP95: pct(ord, 95), latP99: pct(ord, 99),
    latMax: ord[ord.length - 1], status,
  };
  console.log(`\n--- ${rotulo} ---`);
  console.log(`  Sucessos/Erros: ${ok}/${N - ok}  | Taxa erro: ${r.taxaErro.toFixed(1)}%`);
  console.log(`  Lat media: ${media.toFixed(1)}ms  p95: ${r.latP95.toFixed(1)}ms  p99: ${r.latP99.toFixed(1)}ms  max: ${r.latMax.toFixed(1)}ms`);
  console.log(`  Status: ${JSON.stringify(status)}`);
  return r;
}

async function main() {
  const arqCat = join(RAIZ, 'packages/catalog/src/server.ts');
  const arqChk = join(RAIZ, 'packages/checkout/src/server.ts');

  console.log(`Chaos: latency=${CHAOS_LATENCY_MS}ms fail_rate=${CHAOS_FAIL_RATE}  N=${N}`);
  subir(arqCat, {
    CATALOG_PORT: String(PORTA_CATALOGO),
    CHAOS_LATENCY_MS: String(CHAOS_LATENCY_MS),
    CHAOS_FAIL_RATE: String(CHAOS_FAIL_RATE),
  });
  await esperar(URL_CATALOGO);

  // Braco A: flag OFF (sequencial, sem timeout/retry).
  const off = subir(arqChk, { PORT: String(PORTA_CHECKOUT), CATALOG_URL: URL_CATALOGO });
  await esperar(URL_CHECKOUT);
  const rOff = await bateria('FLAG OFF (atual: sequencial, sem timeout/retry)');
  await matar(off);
  await dormir(300);

  // Braco B: flag ON (paralelo + timeout + retry + fallback 503).
  subir(arqChk, {
    PORT: String(PORTA_CHECKOUT),
    CATALOG_URL: URL_CATALOGO,
    FLAGS: '{"checkoutResiliente":{"enabled":true}}',
  });
  await esperar(URL_CHECKOUT);
  const rOn = await bateria('FLAG ON (resiliente: paralelo + timeout + retry + 503)');

  console.log('\n=== COMPARATIVO (mesmo catalogo degradado) ===');
  console.log(`  Taxa erro : OFF ${rOff.taxaErro.toFixed(1)}%  ->  ON ${rOn.taxaErro.toFixed(1)}%`);
  console.log(`  Lat media : OFF ${rOff.latMedia.toFixed(1)}ms ->  ON ${rOn.latMedia.toFixed(1)}ms`);
  console.log(`  Lat p99   : OFF ${rOff.latP99.toFixed(1)}ms ->  ON ${rOn.latP99.toFixed(1)}ms`);
  console.log('\nRESULTADO_JSON=' + JSON.stringify({ off: rOff, on: rOn }));
}

async function fim(c) {
  await Promise.all([...procs].map(matar));
  process.exit(c);
}
process.on('SIGINT', () => fim(130));
process.on('SIGTERM', () => fim(143));
main().then(() => fim(0)).catch(async (e) => {
  console.error('[ERRO]', e?.message ?? e);
  await fim(1);
});
