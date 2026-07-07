#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Experimento de Chaos Engineering - QualiCart (Modulo 2)
//
// Metodo cientifico aplicado a resiliencia de um sistema distribuido:
//   1. Mede o ESTADO ESTAVEL (baseline) do checkout com o catalogo saudavel.
//   2. Formula uma HIPOTESE.
//   3. INJETA a falha no catalogo (latencia e/ou 503) e mede de novo.
//   4. Compara e imprime o APRENDIZADO.
//
// Blast radius minimo: tudo roda em processos locais, portas dedicadas
//   3200 (checkout) e 3201 (catalogo), sem tocar em ambientes reais.
//
// Teardown garantido: os processos filhos sao mortos em qualquer saida.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

const PORTA_CATALOGO = 3201;
const PORTA_CHECKOUT = 3200;
const URL_CHECKOUT = `http://localhost:${PORTA_CHECKOUT}`;
const URL_CATALOGO = `http://localhost:${PORTA_CATALOGO}`;

// Parametros do experimento (podem ser sobrescritos por env).
const N_REQUISICOES = Number(process.env.N_REQ ?? 50);
const CHAOS_LATENCY_MS = Number(process.env.CHAOS_LATENCY_MS ?? 300);
const CHAOS_FAIL_RATE = Number(process.env.CHAOS_FAIL_RATE ?? 0.5);

// Payload valido de checkout (SKUs existem no catalogo em memoria).
const PAYLOAD = JSON.stringify({
  itens: [
    { sku: 'CAM-001', quantidade: 2 },
    { sku: 'CAN-001', quantidade: 1 },
  ],
  cep: '01000-000',
  nomeCliente: 'Chaos Tester',
  emailCliente: 'chaos@qualicart.dev',
});

const processosAtivos = new Set();

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sobe um servico Node (server.ts) com envs extras e devolve o handle.
function subirServico(nome, arquivo, env) {
  const filho = spawn('node', [arquivo], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  filho._nomeServico = nome;
  processosAtivos.add(filho);
  filho.on('exit', () => processosAtivos.delete(filho));
  return filho;
}

async function esperarSaudavel(url, tentativas = 50) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return true;
    } catch {
      // ainda subindo
    }
    // Checkout nao tem /health: qualquer resposta HTTP ja indica que subiu.
    try {
      const r = await fetch(url);
      if (r.status > 0) return true;
    } catch {
      // ainda subindo
    }
    await dormir(200);
  }
  throw new Error(`Servico em ${url} nao ficou saudavel a tempo`);
}

function matarProcesso(filho) {
  return new Promise((resolve) => {
    if (!filho || filho.exitCode !== null || filho.signalCode !== null) {
      resolve();
      return;
    }
    filho.once('exit', () => resolve());
    filho.kill('SIGTERM');
    // Rede de seguranca: SIGKILL se demorar.
    setTimeout(() => {
      if (filho.exitCode === null && filho.signalCode === null) {
        filho.kill('SIGKILL');
      }
    }, 2000);
  });
}

async function matarTodos() {
  await Promise.all([...processosAtivos].map((p) => matarProcesso(p)));
}

// Estatisticas -----------------------------------------------------------------

function percentil(ordenados, p) {
  if (ordenados.length === 0) return 0;
  const idx = Math.min(
    ordenados.length - 1,
    Math.ceil((p / 100) * ordenados.length) - 1,
  );
  return ordenados[Math.max(0, idx)];
}

// Dispara N requisicoes POST /checkout e coleta latencias e status.
async function rodarBateria(rotulo) {
  const latencias = [];
  let sucessos = 0;
  let erros = 0;
  const statusVistos = {};

  for (let i = 0; i < N_REQUISICOES; i += 1) {
    const inicio = performance.now();
    let status = 0;
    try {
      const resp = await fetch(`${URL_CHECKOUT}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: PAYLOAD,
      });
      status = resp.status;
      await resp.text(); // drena o corpo
    } catch {
      status = -1; // falha de rede/conexao
    }
    const dur = performance.now() - inicio;
    latencias.push(dur);
    statusVistos[status] = (statusVistos[status] ?? 0) + 1;
    if (status === 200) sucessos += 1;
    else erros += 1;
  }

  const ordenados = [...latencias].sort((a, b) => a - b);
  const media = latencias.reduce((s, v) => s + v, 0) / latencias.length;

  return {
    rotulo,
    total: N_REQUISICOES,
    sucessos,
    erros,
    taxaErro: (erros / N_REQUISICOES) * 100,
    latMedia: media,
    latP50: percentil(ordenados, 50),
    latP95: percentil(ordenados, 95),
    latMin: ordenados[0],
    latMax: ordenados[ordenados.length - 1],
    statusVistos,
  };
}

function formatarMs(v) {
  return `${v.toFixed(1)} ms`;
}

function imprimirResultado(r) {
  console.log(`\n--- ${r.rotulo} ---`);
  console.log(`  Requisicoes...: ${r.total}`);
  console.log(`  Sucessos (200): ${r.sucessos}`);
  console.log(`  Erros.........: ${r.erros}`);
  console.log(`  Taxa de erro..: ${r.taxaErro.toFixed(1)}%`);
  console.log(`  Latencia media: ${formatarMs(r.latMedia)}`);
  console.log(`  Latencia p50..: ${formatarMs(r.latP50)}`);
  console.log(`  Latencia p95..: ${formatarMs(r.latP95)}`);
  console.log(`  Latencia min..: ${formatarMs(r.latMin)}`);
  console.log(`  Latencia max..: ${formatarMs(r.latMax)}`);
  console.log(`  Status vistos.: ${JSON.stringify(r.statusVistos)}`);
}

// Orquestracao -----------------------------------------------------------------

async function main() {
  console.log('===============================================================');
  console.log(' EXPERIMENTO DE CHAOS ENGINEERING - QualiCart (Modulo 2)');
  console.log('===============================================================');
  console.log(`  Catalogo : ${URL_CATALOGO}`);
  console.log(`  Checkout : ${URL_CHECKOUT}`);
  console.log(`  N req/bateria: ${N_REQUISICOES}`);
  console.log(`  Chaos: CHAOS_LATENCY_MS=${CHAOS_LATENCY_MS}  CHAOS_FAIL_RATE=${CHAOS_FAIL_RATE}`);

  const arqCatalogo = join(RAIZ, 'packages/catalog/src/server.ts');
  const arqCheckout = join(RAIZ, 'packages/checkout/src/server.ts');

  // -------------------- FASE 1: ESTADO ESTAVEL (BASELINE) --------------------
  console.log('\n[1] Subindo catalogo SAUDAVEL (sem chaos) e checkout...');
  let catalogo = subirServico('catalogo', arqCatalogo, {
    CATALOG_PORT: String(PORTA_CATALOGO),
  });
  const checkout = subirServico('checkout', arqCheckout, {
    PORT: String(PORTA_CHECKOUT),
    CATALOG_URL: URL_CATALOGO,
  });

  await esperarSaudavel(URL_CATALOGO);
  await esperarSaudavel(URL_CHECKOUT);
  console.log('    Servicos no ar. Rodando bateria BASELINE...');
  const baseline = await rodarBateria('BASELINE (catalogo saudavel)');
  imprimirResultado(baseline);

  // -------------------- FASE 2: INJECAO DA FALHA -----------------------------
  console.log('\n[2] Derrubando catalogo saudavel e reinjetando com CHAOS...');
  await matarProcesso(catalogo);
  await dormir(300);

  catalogo = subirServico('catalogo-chaos', arqCatalogo, {
    CATALOG_PORT: String(PORTA_CATALOGO),
    CHAOS_LATENCY_MS: String(CHAOS_LATENCY_MS),
    CHAOS_FAIL_RATE: String(CHAOS_FAIL_RATE),
  });
  await esperarSaudavel(URL_CATALOGO);
  console.log('    Catalogo degradado no ar. Rodando bateria COM CHAOS...');
  const comChaos = await rodarBateria('COM CHAOS (latencia + 503)');
  imprimirResultado(comChaos);

  // -------------------- FASE 3: COMPARATIVO ----------------------------------
  console.log('\n===============================================================');
  console.log(' COMPARATIVO BASELINE vs. CHAOS');
  console.log('===============================================================');
  const linha = (rot, a, b, suf = '') =>
    console.log(
      `  ${rot.padEnd(18)} | baseline: ${String(a).padStart(9)}${suf} | chaos: ${String(b).padStart(9)}${suf}`,
    );
  linha('Taxa de erro', baseline.taxaErro.toFixed(1), comChaos.taxaErro.toFixed(1), '%');
  linha('Latencia media', baseline.latMedia.toFixed(1), comChaos.latMedia.toFixed(1), 'ms');
  linha('Latencia p95', baseline.latP95.toFixed(1), comChaos.latP95.toFixed(1), 'ms');
  linha('Latencia max', baseline.latMax.toFixed(1), comChaos.latMax.toFixed(1), 'ms');

  const deltaLat = comChaos.latMedia - baseline.latMedia;
  console.log(`\n  Delta de latencia media (chaos - baseline): ${deltaLat.toFixed(1)} ms`);
  console.log(`  Delta de taxa de erro: ${(comChaos.taxaErro - baseline.taxaErro).toFixed(1)} pontos percentuais`);

  // Emite JSON no final para facilitar captura automatizada.
  console.log('\nRESULTADO_JSON=' + JSON.stringify({ baseline, comChaos }));
}

// Teardown em qualquer cenario ------------------------------------------------
async function finalizar(codigo) {
  console.log('\n[teardown] Encerrando processos (checkout + catalogo)...');
  await matarTodos();
  console.log('[teardown] Concluido. Sem processos orfaos.');
  process.exit(codigo);
}

process.on('SIGINT', () => finalizar(130));
process.on('SIGTERM', () => finalizar(143));

main()
  .then(() => finalizar(0))
  .catch(async (erro) => {
    console.error('\n[ERRO] Experimento falhou:', erro?.message ?? erro);
    await finalizar(1);
  });
