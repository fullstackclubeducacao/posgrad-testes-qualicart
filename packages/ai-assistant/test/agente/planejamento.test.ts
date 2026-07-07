// TESTES DE AGENTE -- FRENTE 2: PLANEJAMENTO (a sequencia de passos)
//
// Aqui nao avaliamos so' o passo isolado, e sim a TRAJETORIA: o agente alcanca
// o objetivo encadeando ferramentas de forma sensata, TERMINA com uma resposta
// (nao desiste no meio), NAO faz passos absurdos e -- crucial -- NAO entra em
// loop infinito: respeita o teto MAX_ITERACOES (=5 em agent.ts).
//
// Usamos um LlmClient "roteiro" (scripted) para dirigir uma trajetoria de
// varios passos de forma deterministica, e o FakeLlmClient para a trajetoria
// natural de um passo. Ambos contam quantas vezes o LLM foi chamado.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssistenteCheckout } from '../../src/agent.ts';
import { FakeLlmClient } from '../../src/llm-client.ts';
import type {
  LlmClient,
  ParamsGeracao,
  TurnoAssistente,
} from '../../src/llm-client.ts';
import { criarFerramentasPadrao } from '../../src/tools.ts';
import type { Ferramentas } from '../../src/tools.ts';
import { MENSAGEM_FALLBACK } from '../../src/guardrails.ts';
import { PedidoRepositoryMemoria } from '../../../checkout/src/pedido-repository.ts';

/** MAX_ITERACOES real do agente (agent.ts). Se mudar la, ajuste aqui. */
const MAX_ITERACOES = 5;

/** LlmClient dirigido por um roteiro fixo de turnos; conta as chamadas. */
class LlmRoteiro implements LlmClient {
  #turnos: TurnoAssistente[];
  chamadas = 0;

  constructor(turnos: TurnoAssistente[]) {
    this.#turnos = turnos;
  }

  async gerar(_params: ParamsGeracao): Promise<TurnoAssistente> {
    const turno = this.#turnos[this.chamadas] ?? {
      texto: 'Pronto.',
      toolUses: [],
      stopReason: 'fim' as const,
    };
    this.chamadas++;
    return turno;
  }
}

/** Envolve um LlmClient para contar quantas vezes foi chamado. */
class LlmContador implements LlmClient {
  #interno: LlmClient;
  chamadas = 0;

  constructor(interno: LlmClient) {
    this.#interno = interno;
  }

  async gerar(params: ParamsGeracao): Promise<TurnoAssistente> {
    this.chamadas++;
    return this.#interno.gerar(params);
  }
}

const PRECOS: Record<string, { nome: string; preco: number }> = {
  'FON-001': { nome: 'Fone', preco: 200 },
};

function ferramentasMockadas(overrides: Partial<Ferramentas> = {}): Ferramentas {
  return criarFerramentasPadrao({
    buscarProduto: (sku: string) => {
      const p = PRECOS[sku];
      return p === undefined ? undefined : { sku, nome: p.nome, preco: p.preco };
    },
    ...overrides,
  });
}

describe('Planejamento: trajetoria correta e limitada', () => {
  it('plano de 2 passos: buscar_produto -> calcular_total -> resposta final (encadeamento sensato)', async () => {
    // Objetivo: descobrir o preco do fone e entao o total do carrinho com ele.
    const roteiro = new LlmRoteiro([
      {
        texto: '',
        toolUses: [{ id: 't1', nome: 'buscar_produto', input: { sku: 'FON-001' } }],
        stopReason: 'ferramenta',
      },
      {
        texto: '',
        toolUses: [
          {
            id: 't2',
            nome: 'calcular_total',
            input: { itens: [{ sku: 'FON-001', quantidade: 1 }], cep: '01000-000' },
          },
        ],
        stopReason: 'ferramenta',
      },
      { texto: 'Seu total ficou em R$215,00.', toolUses: [], stopReason: 'fim' },
    ]);

    const assistente = new AssistenteCheckout(roteiro, {
      ferramentas: ferramentasMockadas(),
    });
    const r = await assistente.responder('quero saber o total com 1 fone');

    // Encadeou as duas ferramentas na ordem esperada...
    assert.deepEqual(r.ferramentasUsadas, ['buscar_produto', 'calcular_total']);
    // ...terminou com uma resposta util (nao desistiu no meio)...
    assert.match(r.resposta, /total/i);
    assert.notEqual(r.recusado, true);
    // ...e o plano foi eficiente: 3 turnos de LLM, bem abaixo do teto.
    assert.equal(roteiro.chamadas, 3);
    assert.ok(roteiro.chamadas <= MAX_ITERACOES);
  });

  it('trajetoria natural de 1 passo: consulta -> formata -> encerra em 2 turnos (sem passos extras)', async () => {
    const repo = new PedidoRepositoryMemoria();
    const pedido = await repo.salvar({
      itens: [],
      subtotal: 100,
      desconto: 0,
      frete: 0,
      total: 100,
    });
    const contador = new LlmContador(new FakeLlmClient());
    const assistente = new AssistenteCheckout(contador, {
      ferramentas: ferramentasMockadas({ pedidos: repo }),
    });

    const r = await assistente.responder(`qual o status do pedido ${pedido.id}?`);

    assert.deepEqual(r.ferramentasUsadas, ['consultar_pedido']);
    assert.match(r.resposta, /confirmado/);
    // 1 turno para pedir a ferramenta + 1 turno para redigir a resposta.
    assert.equal(contador.chamadas, 2);
  });

  it('NAO entra em loop infinito: LLM que sempre pede ferramenta para no teto e cai no fallback', async () => {
    // LLM patologico: nunca encerra, sempre emite outro tool_use.
    const semFim: LlmClient = {
      async gerar(): Promise<TurnoAssistente> {
        return {
          texto: '',
          toolUses: [{ id: 'x', nome: 'buscar_produto', input: { sku: 'FON-001' } }],
          stopReason: 'ferramenta',
        };
      },
    };
    const assistente = new AssistenteCheckout(semFim, {
      ferramentas: ferramentasMockadas(),
    });

    const r = await assistente.responder('me diga o preço do fone');

    // A contencao (MAX_ITERACOES) segurou: exatamente 5 execucoes, nem mais.
    assert.equal(r.ferramentasUsadas.length, MAX_ITERACOES);
    // E terminou com uma mensagem segura, sem travar o processo.
    assert.equal(r.resposta, MENSAGEM_FALLBACK);
    assert.equal(r.recusado, false);
  });
});
