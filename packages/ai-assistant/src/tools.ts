// Ferramentas do agente (tool use) + executores com "least privilege".
//
// TODAS as ferramentas expostas sao SOMENTE-LEITURA / baixo impacto: buscam
// produto, calculam total, explicam cupom e consultam pedido. Nenhuma apaga,
// gasta ou envia nada. A acao de alto impacto `finalizar_pedido` esta modelada
// como CONTENCAO: exige `confirmadoPeloUsuario` e, sem ele, NAO executa --
// apenas devolve um pedido de confirmacao. Por padrao ela NAO e exposta ao LLM
// (ver FERRAMENTAS), reduzindo a superficie de ataque.
//
// Os executores recebem um objeto de dependencias `Ferramentas` (injecao),
// para os testes mockarem o dominio. O default (producao) usa o dominio real,
// tudo OFFLINE (funcoes puras + dados em memoria), sem HTTP.

import { buscarProduto as buscarProdutoCatalogo } from '../../catalog/src/products.ts';
import { processarCheckout } from '../../checkout/src/checkout.ts';
import { PedidoRepositoryMemoria } from '../../checkout/src/pedido-repository.ts';
import type { Produto } from '../../catalog/src/produto.ts';
import type { Cupom } from '../../checkout/src/coupon.ts';
import type { ItemCarrinho } from '../../checkout/src/cart.ts';
import type { PedidoRepository } from '../../checkout/src/pedido-repository.ts';

// ---------------------------------------------------------------------------
// Definicoes (schema) das ferramentas expostas ao LLM
// ---------------------------------------------------------------------------

export type SchemaFerramenta = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

export type DefinicaoFerramenta = {
  name: string;
  description: string;
  input_schema: SchemaFerramenta;
};

/** Definicoes com descricoes PRESCRITIVAS de quando usar cada ferramenta. */
export const FERRAMENTAS: DefinicaoFerramenta[] = [
  {
    name: 'buscar_produto',
    description:
      'Use quando o cliente perguntar sobre um produto específico, seu preço ' +
      'ou disponibilidade. Recebe o SKU (ex.: CAM-001). Retorna nome e preço.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'SKU do produto, formato AAA-000.' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'calcular_total',
    description:
      'Use quando o cliente quiser saber o total do carrinho, quanto fica a ' +
      'compra, ou o efeito de um cupom no valor. Recebe os itens (sku + ' +
      'quantidade), um código de cupom opcional e o CEP de destino.',
    input_schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantidade: { type: 'number' },
            },
            required: ['sku', 'quantidade'],
          },
        },
        cupom: { type: 'string', description: 'Código do cupom (opcional).' },
        cep: { type: 'string', description: 'CEP de destino para o frete.' },
      },
      required: ['itens', 'cep'],
    },
  },
  {
    name: 'aplicar_cupom_info',
    description:
      'Use quando o cliente perguntar o que um cupom faz, se é válido ou como ' +
      'aplicá-lo. Recebe o código do cupom. Retorna a descrição da regra.',
    input_schema: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Código do cupom.' },
      },
      required: ['codigo'],
    },
  },
  {
    name: 'consultar_pedido',
    description:
      'Use quando o cliente perguntar o status ou os detalhes de um pedido já ' +
      'realizado. Recebe o id do pedido. Retorna status e valores.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identificador do pedido.' },
      },
      required: ['id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Catalogo de cupons (regras conhecidas) -- somente leitura
// ---------------------------------------------------------------------------

const CUPONS: Record<string, { cupom: Cupom; descricao: string }> = {
  DESCONTO10: {
    cupom: { tipo: 'percentual', valor: 10 },
    descricao: 'DESCONTO10: 10% de desconto no subtotal, sem valor mínimo.',
  },
  DESCONTO25: {
    cupom: { tipo: 'percentual', valor: 25, minimoCarrinho: 100 },
    descricao: 'DESCONTO25: 25% de desconto para carrinhos a partir de R$100.',
  },
  MENOS20: {
    cupom: { tipo: 'fixo', valor: 20 },
    descricao: 'MENOS20: R$20 de desconto fixo no subtotal.',
  },
};

// ---------------------------------------------------------------------------
// Dependencias injetaveis dos executores
// ---------------------------------------------------------------------------

export type Ferramentas = {
  buscarProduto: (sku: string) => Produto | undefined;
  buscarCupom: (codigo: string) => { cupom: Cupom; descricao: string } | undefined;
  pedidos: PedidoRepository;
};

/** Dependencias padrao (producao), 100% offline. */
export function criarFerramentasPadrao(
  overrides: Partial<Ferramentas> = {},
): Ferramentas {
  return {
    buscarProduto: buscarProdutoCatalogo,
    buscarCupom: (codigo: string) => CUPONS[codigo.toUpperCase()],
    pedidos: new PedidoRepositoryMemoria(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Executores
// ---------------------------------------------------------------------------

/** Resultado serializavel de uma ferramenta (vira o content do tool_result). */
export type ResultadoFerramenta = Record<string, unknown>;

type Executor = (input: unknown, deps: Ferramentas) => Promise<ResultadoFerramenta>;

function comoObjeto(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

const executarBuscarProduto: Executor = async (input, deps) => {
  const sku = String(comoObjeto(input)['sku'] ?? '');
  if (sku === '') {
    return { erro: 'SKU não informado' };
  }
  const produto = deps.buscarProduto(sku);
  if (produto === undefined) {
    return { erro: `Produto ${sku} não encontrado` };
  }
  return { sku: produto.sku, nome: produto.nome, preco: produto.preco };
};

const executarCalcularTotal: Executor = async (input, deps) => {
  const obj = comoObjeto(input);
  const itensBrutos = Array.isArray(obj['itens']) ? (obj['itens'] as unknown[]) : [];
  const itens: ItemCarrinho[] = [];

  for (const bruto of itensBrutos) {
    const item = comoObjeto(bruto);
    const sku = String(item['sku'] ?? '');
    const quantidade = Number(item['quantidade'] ?? 0);
    const produto = deps.buscarProduto(sku);
    if (produto === undefined) {
      return { erro: `Produto ${sku} não encontrado no carrinho` };
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return { erro: `Quantidade inválida para ${sku}` };
    }
    itens.push({
      sku: produto.sku,
      nome: produto.nome,
      precoUnitario: produto.preco,
      quantidade,
    });
  }

  const codigoCupom = obj['cupom'];
  let cupom: Cupom | null = null;
  if (typeof codigoCupom === 'string' && codigoCupom !== '') {
    const encontrado = deps.buscarCupom(codigoCupom);
    if (encontrado === undefined) {
      return { erro: `Cupom ${codigoCupom} inválido` };
    }
    cupom = encontrado.cupom;
  }

  const cep = String(obj['cep'] ?? '01000-000');
  const r = processarCheckout(itens, cupom, cep, '', '', false, '');
  return { subtotal: r.subtotal, desconto: r.desconto, frete: r.frete, total: r.total };
};

const executarAplicarCupomInfo: Executor = async (input, deps) => {
  const codigo = String(comoObjeto(input)['codigo'] ?? '');
  if (codigo === '') {
    return { erro: 'Código de cupom não informado' };
  }
  const encontrado = deps.buscarCupom(codigo);
  if (encontrado === undefined) {
    return { erro: `Cupom ${codigo} inválido ou expirado` };
  }
  return { codigo: codigo.toUpperCase(), descricao: encontrado.descricao };
};

const executarConsultarPedido: Executor = async (input, deps) => {
  const id = String(comoObjeto(input)['id'] ?? '');
  if (id === '') {
    return { erro: 'Id do pedido não informado' };
  }
  const pedido = await deps.pedidos.buscarPorId(id);
  if (pedido === null) {
    return { erro: `Pedido ${id} não encontrado` };
  }
  return {
    id: pedido.id,
    status: 'confirmado',
    total: pedido.total,
    criadoEm: pedido.criadoEm,
  };
};

/**
 * Exemplo de CONTENCAO de acao de alto impacto. NAO esta em FERRAMENTAS (nao e'
 * exposta ao LLM). Se um dia for exposta, ela EXIGE confirmacao humana
 * explicita: sem `confirmadoPeloUsuario`, apenas devolve um pedido de
 * confirmacao e NAO executa.
 */
export async function finalizarPedido(input: unknown): Promise<ResultadoFerramenta> {
  const confirmado = comoObjeto(input)['confirmadoPeloUsuario'] === true;
  if (!confirmado) {
    return {
      requerConfirmacao: true,
      mensagem:
        'Esta ação finaliza e cobra o pedido. Confirme explicitamente para prosseguir.',
    };
  }
  return { finalizado: false, mensagem: 'Finalização real desabilitada nesta fase.' };
}

/** Registro nome->executor das ferramentas expostas. */
export const EXECUTORES: Record<string, Executor> = {
  buscar_produto: executarBuscarProduto,
  calcular_total: executarCalcularTotal,
  aplicar_cupom_info: executarAplicarCupomInfo,
  consultar_pedido: executarConsultarPedido,
};
