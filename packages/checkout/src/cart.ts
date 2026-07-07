// Carrinho de compras: tipos e calculo de subtotal.

export type ItemCarrinho = {
  sku: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
};

/**
 * Soma preco unitario * quantidade de todos os itens do carrinho.
 */
export function calcularSubtotal(itens: ItemCarrinho[]): number {
  let subtotal = 0;
  for (const item of itens) {
    subtotal += item.precoUnitario * item.quantidade;
  }
  return subtotal;
}
