// Orquestracao de I/O + logica pura do checkout.
//
// Resolve precos no catalogo (HTTP), aplica a logica pura `processarCheckout`
// e persiste o pedido via um `PedidoRepository` injetado.

import { processarCheckout } from './checkout.ts';
import { buscarProduto as buscarProdutoNoCatalogo } from './catalog-client.ts';
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
