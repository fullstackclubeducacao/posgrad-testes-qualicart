// Teste de carga SLO-DRIVEN do endpoint POST /checkout com k6.
//
// A diferenca para o `checkout-carga.js` (Modulo 2) e a INTENCAO: la os
// thresholds eram "metas de carga" que o servico local consegue cumprir; aqui
// os thresholds SAO OS SLOs do servico. Com isso o teste de carga deixa de
// perguntar "funciona?" e passa a perguntar "funciona DENTRO DO SLO?".
//
// Se qualquer SLO for violado, o k6 marca o threshold como cruzado (linha
// vermelha no sumario) e ENCERRA COM EXIT CODE != 0 -> o teste REPROVA e, num
// pipeline, o gate de release bloqueia a entrega.
//
// SLOs do checkout (ver docs/modulo-3/slo-error-budget.md):
//   - Disponibilidade: >= 99,5% das requisicoes com sucesso
//       -> http_req_failed rate < 0.005  (0,5% de orcamento de erro)
//       -> checks         rate > 0.995
//   - Latencia:      p99 do checkout < 400ms  (cauda controlada)
//                    p95 do checkout < 250ms  (experiencia tipica)
//
// Como rodar:
//   BASE_URL=http://localhost:3400 k6 run load/checkout-slo.js
//   npm run slo:load                     (usa o default http://localhost:3400)
//
// Pre-requisitos: catalogo (3401) e checkout (3400) no ar.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3400';

export const options = {
  // Perfil de RAMP-UP: sobe ate 30 VUs em 20s, sustenta 30s, desce em 10s.
  stages: [
    { duration: '20s', target: 30 }, // ramp-up: 0 -> 30 usuarios virtuais
    { duration: '30s', target: 30 }, // sustentacao (steady state)
    { duration: '10s', target: 0 },  // ramp-down: 30 -> 0
  ],

  // OS THRESHOLDS SAO OS SLOs. Estourar qualquer um REPROVA o teste (exit != 0).
  // `abortOnFail` deixa explicito que o SLO violado e criterio de parada.
  thresholds: {
    // SLO de latencia: cauda (p99) e experiencia tipica (p95).
    http_req_duration: ['p(99)<400', 'p(95)<250'],
    // SLO de disponibilidade: 99,5% de sucesso => < 0,5% de erro HTTP.
    http_req_failed: [{ threshold: 'rate<0.005', abortOnFail: false }],
    // Validacoes de negocio (status 200 + total numerico) acima de 99,5%.
    checks: ['rate>0.995'],
  },
};

// Corpo de checkout valido: SKUs existentes no catalogo, CEP e cliente.
const payload = JSON.stringify({
  itens: [
    { sku: 'CAM-001', quantidade: 2 },
    { sku: 'CAN-001', quantidade: 1 },
    { sku: 'LIV-001', quantidade: 3 },
  ],
  cupom: null,
  cep: '01311000',
  nomeCliente: 'Cliente SLO',
  emailCliente: 'slo@qualicart.dev',
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

  sleep(1); // think time: pausa do usuario entre requisicoes
}
