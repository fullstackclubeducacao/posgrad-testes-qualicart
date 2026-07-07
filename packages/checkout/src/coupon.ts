// Regras de cupom de desconto.

export type Cupom =
  | { tipo: 'percentual'; valor: number; minimoCarrinho?: number }
  | { tipo: 'fixo'; valor: number; minimoCarrinho?: number };

/**
 * Aplica um cupom sobre o subtotal e retorna o novo subtotal com desconto.
 *
 * - Cupom "percentual": desconta `valor`% do subtotal.
 * - Cupom "fixo": desconta `valor` reais (o total nunca fica negativo).
 * - Se `minimoCarrinho` for definido e o subtotal nao atingir esse minimo,
 *   o cupom nao se aplica e o subtotal original e retornado.
 */
export function aplicarCupom(subtotal: number, cupom: Cupom): number {
  if (cupom.minimoCarrinho !== undefined) {
    if (subtotal >= cupom.minimoCarrinho) {
      return descontar(subtotal, cupom);
    }
    return subtotal;
  }

  return descontar(subtotal, cupom);
}

function descontar(subtotal: number, cupom: Cupom): number {
  if (cupom.tipo === 'percentual') {
    const desconto = subtotal * (cupom.valor / 100);
    return subtotal - desconto;
  }

  const total = subtotal - cupom.valor;
  return total < 0 ? 0 : total;
}
