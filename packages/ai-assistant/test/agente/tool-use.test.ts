// TESTES DE AGENTE -- FRENTE 1: TOOL USE (com ferramentas mockadas)
//
// Objetivo: para varios pedidos do cliente, verificar que o agente escolhe a
// ferramenta CERTA com os PARAMETROS certos. Um agente pode "acertar a resposta
// pelo motivo errado" (chamar a ferramenta errada e ainda assim redigir algo
// plausivel); por isso asseramos sobre o par (nome da ferramenta, input).
//
// Estrategia: um LlmClient ESPIAO envolve o FakeLlmClient (deterministico,
// offline) e registra TODO tool_use emitido -- nome + input exato -- antes da
// execucao. As dependencias de dominio tambem sao MOCKADAS para confirmar, em
// segundo nivel, com quais argumentos os executores foram invocados.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssistenteCheckout } from '../../src/agent.ts';
import { FakeLlmClient } from '../../src/llm-client.ts';
import type {
  LlmClient,
  ParamsGeracao,
  ToolUse,
  TurnoAssistente,
} from '../../src/llm-client.ts';
import { criarFerramentasPadrao } from '../../src/tools.ts';
import type { Ferramentas } from '../../src/tools.ts';
import { PedidoRepositoryMemoria } from '../../../checkout/src/pedido-repository.ts';
import type { Pedido } from '../../../checkout/src/pedido-repository.ts';

/** Envolve um LlmClient e registra todos os tool_use emitidos (nome + input). */
class LlmEspiao implements LlmClient {
  readonly chamadas: ToolUse[] = [];
  #interno: LlmClient;

  constructor(interno: LlmClient) {
    this.#interno = interno;
  }

  async gerar(params: ParamsGeracao): Promise<TurnoAssistente> {
    const turno = await this.#interno.gerar(params);
    this.chamadas.push(...turno.toolUses);
    return turno;
  }
}

/** Catalogo de precos usado pelos mocks (valores redondos e estaveis). */
const PRECOS: Record<string, { nome: string; preco: number }> = {
  'FON-001': { nome: 'Fone', preco: 200 },
  'CAM-001': { nome: 'Camiseta', preco: 50 },
  'TEC-001': { nome: 'Teclado', preco: 250 },
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

describe('Tool use: ferramenta e parametros corretos', () => {
  it('"qual o preço do fone?" -> buscar_produto({ sku: "FON-001" })', async () => {
    const espiao = new LlmEspiao(new FakeLlmClient());
    const assistente = new AssistenteCheckout(espiao, {
      ferramentas: ferramentasMockadas(),
    });

    const r = await assistente.responder('qual o preço do fone?');

    assert.deepEqual(r.ferramentasUsadas, ['buscar_produto']);
    assert.equal(espiao.chamadas.length, 1);
    const [chamada] = espiao.chamadas;
    assert.equal(chamada?.nome, 'buscar_produto');
    assert.deepEqual(chamada?.input, { sku: 'FON-001' });
    assert.match(r.resposta, /Fone/);
  });

  it('"total com 2 fones e cupom DESCONTO25" -> calcular_total com itens + cupom + cep certos', async () => {
    const espiao = new LlmEspiao(new FakeLlmClient());
    const assistente = new AssistenteCheckout(espiao, {
      ferramentas: ferramentasMockadas(),
    });

    const r = await assistente.responder(
      'quanto fica o carrinho com 2 fones e o cupom DESCONTO25, cep 20000-000?',
    );

    assert.deepEqual(r.ferramentasUsadas, ['calcular_total']);
    const [chamada] = espiao.chamadas;
    assert.equal(chamada?.nome, 'calcular_total');
    const input = chamada?.input as {
      itens: Array<{ sku: string; quantidade: number }>;
      cupom?: string;
      cep: string;
    };
    // Item resolvido do texto (nome -> SKU) com a quantidade correta.
    assert.deepEqual(input.itens, [{ sku: 'FON-001', quantidade: 2 }]);
    // Cupom exato mencionado na mensagem.
    assert.equal(input.cupom, 'DESCONTO25');
    // CEP extraido da mensagem (nao o default).
    assert.equal(input.cep, '20000-000');
  });

  it('"status do pedido 123" -> consultar_pedido({ id: "123" }) e repo consultado com "123"', async () => {
    const idsConsultados: string[] = [];
    const repo = new PedidoRepositoryMemoria();
    const ferramentas = ferramentasMockadas({
      pedidos: {
        async salvar() {
          throw new Error('nao usado neste teste');
        },
        async buscarPorId(id: string): Promise<Pedido | null> {
          idsConsultados.push(id);
          return repo.buscarPorId(id);
        },
      },
    });

    const espiao = new LlmEspiao(new FakeLlmClient());
    const assistente = new AssistenteCheckout(espiao, { ferramentas });

    const r = await assistente.responder('qual o status do pedido 123?');

    assert.deepEqual(r.ferramentasUsadas, ['consultar_pedido']);
    const [chamada] = espiao.chamadas;
    assert.equal(chamada?.nome, 'consultar_pedido');
    assert.deepEqual(chamada?.input, { id: '123' });
    // 2o nivel: o executor realmente consultou o repositorio com o id certo.
    assert.deepEqual(idsConsultados, ['123']);
  });

  it('"o que faz o cupom DESCONTO10?" -> aplicar_cupom_info({ codigo: "DESCONTO10" })', async () => {
    const espiao = new LlmEspiao(new FakeLlmClient());
    const assistente = new AssistenteCheckout(espiao, {
      ferramentas: ferramentasMockadas(),
    });

    const r = await assistente.responder('o que faz o cupom DESCONTO10?');

    assert.deepEqual(r.ferramentasUsadas, ['aplicar_cupom_info']);
    const [chamada] = espiao.chamadas;
    assert.equal(chamada?.nome, 'aplicar_cupom_info');
    assert.deepEqual(chamada?.input, { codigo: 'DESCONTO10' });
  });

  it('saudacao ("oi, bom dia") NAO dispara nenhuma ferramenta (nao gasta chamadas a` toa)', async () => {
    const espiao = new LlmEspiao(new FakeLlmClient());
    const assistente = new AssistenteCheckout(espiao, {
      ferramentas: ferramentasMockadas(),
    });

    const r = await assistente.responder('oi, bom dia!');

    assert.deepEqual(r.ferramentasUsadas, []);
    assert.equal(espiao.chamadas.length, 0);
    assert.notEqual(r.recusado, true);
  });
});
