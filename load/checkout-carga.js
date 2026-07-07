// Teste de CARGA (load test) do endpoint POST /checkout com k6.
//
// Objetivo pedagogico: demonstrar um perfil de RAMP-UP (subir carga aos poucos,
// sustentar, descer) e a leitura de resultados por PERCENTIL (p95/p99) em vez
// de olhar so a media. As metas (thresholds) sao SLIs com alvo por percentil,
// que sao a semente de um SLO (ver Modulo 3).
//
// Como rodar:
//   k6 run load/checkout-carga.js
//   BASE_URL=http://localhost:3100 k6 run load/checkout-carga.js
//
// Pre-requisitos: catalogo (3101) e checkout (3100) no ar.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';

export const options = {
  // Perfil de RAMP-UP: sobe ate 50 VUs em 30s, sustenta 1min, desce em 20s.
  // Esse formato revela como a latencia se comporta conforme a carga cresce.
  stages: [
    { duration: '30s', target: 50 }, // ramp-up: 0 -> 50 usuarios virtuais
    { duration: '1m', target: 50 },  // sustentacao (steady state)
    { duration: '20s', target: 0 },  // ramp-down: 50 -> 0
  ],

  // METAS por PERCENTIL. O teste "falha" (exit code != 0) se qualquer uma
  // estourar. Sao alvos que o servico local consegue cumprir; o ponto e a
  // META por percentil, nao o numero absoluto.
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<800'], // 95% < 500ms, 99% < 800ms
    checks: ['rate>0.99'],                          // >99% das validacoes ok
    http_req_failed: ['rate<0.01'],                 // <1% de erros HTTP
  },
};

// Corpo de checkout valido: SKUs existentes no catalogo, cupom e CEP.
const payload = JSON.stringify({
  itens: [
    { sku: 'CAM-001', quantidade: 2 },
    { sku: 'CAN-001', quantidade: 1 },
    { sku: 'LIV-001', quantidade: 3 },
  ],
  cupom: null,
  cep: '01311000',
  nomeCliente: 'Cliente de Carga',
  emailCliente: 'carga@qualicart.dev',
});

const params = {
  headers: { 'Content-Type': 'application/json' },
};

export default function () {
  const res = http.post(`${BASE_URL}/checkout`, payload, params);

  check(res, {
    'status e 200': (r) => r.status === 200,
    'corpo tem total': (r) => {
      try {
        return typeof r.json('total') === 'number';
      } catch {
        return false;
      }
    },
  });

  sleep(1); // think time: simula pausa do usuario entre requisicoes
}
