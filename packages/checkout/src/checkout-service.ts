// Orquestracao de I/O + logica pura do checkout.
//
// Resolve precos no catalogo (HTTP), aplica a logica pura `processarCheckout`
// e persiste o pedido via um `PedidoRepository` injetado.
//
// A resolucao de precos tem DOIS caminhos, escolhidos pela feature flag
// `checkoutResiliente` (ver `flags.ts`):
//   - OFF (comportamento atual em producao): sequencial, sem timeout/retry.
//   - ON  (canary): paralelo (Promise.all) + timeout + 1 retry + fallback
//     explicito (CatalogoIndisponivelError -> 503).
// Ambos produzem o MESMO resultado no caminho feliz.

import { processarCheckout } from './checkout.ts';
import {
  buscarProduto as buscarProdutoNoCatalogo,
  ProdutoNaoEncontradoError,
} from './catalog-client.ts';
import { isEnabled } from './flags.ts';
import type { ItemCarrinho } from './cart.ts';
import type { Cupom } from './coupon.ts';
import type { Pedido, PedidoRepository } from './pedido-repository.ts';

export type ItemCheckout = {
  sku: string;
  quantidade: number;
};

export type CheckoutInput = {
  itens: ItemCheckout[];
  cupom?: Cupom | null;
  cep: string;
  nomeCliente?: string;
  emailCliente?: string;
  freteGratisVip?: boolean;
  observacao?: string;
};

// Permite injetar um catalog-client fake nos testes (sem rede).
type BuscarProduto = typeof buscarProdutoNoCatalogo;

// Parametros de resiliencia do caminho novo (canary).
const TIMEOUT_CATALOGO_MS = 800;
const BACKOFF_RETRY_MS = 100;

/**
 * Erro de dominio: o catalogo nao respondeu de forma utilizavel mesmo apos
 * timeout + retry. Decisao arquitetural: FALHAR FECHADO (nao inventamos preco).
 * O `server.ts` traduz este erro para HTTP 503 (indisponibilidade transitoria).
 */
export class CatalogoIndisponivelError extends Error {
  readonly sku: string;

  constructor(sku: string, causa?: unknown) {
    super(`Catalogo indisponivel ao resolver o preco do produto ${sku}`);
    this.name = 'CatalogoIndisponivelError';
    this.sku = sku;
    if (causa !== undefined) {
      this.cause = causa;
    }
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deriva uma chave estavel para o rollout sticky da flag (canary/A-B).
// Preferimos identificar o cliente; caindo para a composicao dos SKUs.
function chaveDeRollout(input: CheckoutInput): string {
  if (input.emailCliente !== undefined && input.emailCliente !== '') {
    return input.emailCliente;
  }
  if (input.nomeCliente !== undefined && input.nomeCliente !== '') {
    return input.nomeCliente;
  }
  return input.itens.map((i) => i.sku).join(',');
}

// -- Caminho ATUAL (flag OFF): sequencial, sem timeout/retry. ----------------
async function resolverPrecosSequencial(
  input: CheckoutInput,
  buscarProduto: BuscarProduto,
): Promise<ItemCarrinho[]> {
  const itensCarrinho: ItemCarrinho[] = [];
  for (const item of input.itens) {
    const produto = await buscarProduto(item.sku);
    itensCarrinho.push({
      sku: produto.sku,
      nome: produto.nome,
      precoUnitario: produto.preco,
      quantidade: item.quantidade,
    });
  }
  return itensCarrinho;
}

// Resolve UM item com timeout + 1 retry. 404 (produto inexistente) NAO e'
// transitorio: propaga direto. Qualquer outra falha vira CatalogoIndisponivel.
async function resolverItemResiliente(
  item: ItemCheckout,
  buscarProduto: BuscarProduto,
): Promise<ItemCarrinho> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      const produto = await buscarProduto(item.sku, {
        timeoutMs: TIMEOUT_CATALOGO_MS,
      });
      return {
        sku: produto.sku,
        nome: produto.nome,
        precoUnitario: produto.preco,
        quantidade: item.quantidade,
      };
    } catch (erro) {
      if (erro instanceof ProdutoNaoEncontradoError) {
        throw erro;
      }
      ultimoErro = erro;
      if (tentativa === 0) {
        await dormir(BACKOFF_RETRY_MS);
      }
    }
  }
  throw new CatalogoIndisponivelError(item.sku, ultimoErro);
}

// -- Caminho NOVO (flag ON): paralelo + timeout + retry + fallback. ----------
async function resolverPrecosResiliente(
  input: CheckoutInput,
  buscarProduto: BuscarProduto,
): Promise<ItemCarrinho[]> {
  return Promise.all(
    input.itens.map((item) => resolverItemResiliente(item, buscarProduto)),
  );
}

/**
 * Finaliza um checkout: resolve precos no catalogo, calcula os valores com a
 * logica pura e persiste o pedido.
 *
 * @param input dados do checkout (itens com sku/quantidade, cupom, cep, etc).
 * @param repo repositorio de pedidos (memoria por default; Postgres em prod).
 * @param buscarProduto cliente do catalogo (injetavel para testes).
 */
export async function finalizarCheckout(
  input: CheckoutInput,
  repo: PedidoRepository,
  buscarProduto: BuscarProduto = buscarProdutoNoCatalogo,
): Promise<Pedido> {
  // Feature flag: escolhe entre o comportamento atual e o resiliente (canary).
  const resiliente = isEnabled('checkoutResiliente', {
    chave: chaveDeRollout(input),
  });

  const itensCarrinho = resiliente
    ? await resolverPrecosResiliente(input, buscarProduto)
    : await resolverPrecosSequencial(input, buscarProduto);

  const resultado = processarCheckout(
    itensCarrinho,
    input.cupom ?? null,
    input.cep,
    input.nomeCliente ?? '',
    input.emailCliente ?? '',
    input.freteGratisVip ?? false,
    input.observacao ?? '',
  );

  const pedido = await repo.salvar({
    itens: itensCarrinho,
    subtotal: resultado.subtotal,
    desconto: resultado.desconto,
    frete: resultado.frete,
    total: resultado.total,
  });

  return pedido;
}
