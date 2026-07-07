// Orquestrador de checkout: junta carrinho + cupom + frete.

import { calcularSubtotal } from './cart.ts';
import { aplicarCupom } from './coupon.ts';
import { calcularFrete } from './shipping.ts';
import type { ItemCarrinho } from './cart.ts';
import type { Cupom } from './coupon.ts';

export type ResultadoCheckout = {
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
};

/**
 * Arredonda um valor monetario para 2 casas decimais (centavos).
 *
 * Dinheiro NUNCA deve carregar erro de ponto flutuante: sem este
 * arredondamento, valores como 119.8 * 0.10 produzem 11.980000000000004.
 */
export function arredondarMoeda(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Processa um checkout completo e devolve o detalhamento de valores.
 *
 * Observacao: esta funcao foi escrita de forma deliberadamente "monolitica"
 * (muitos parametros, ramos aninhados e trechos repetidos). Ela serve de
 * ponto de partida para as atividades de refatoracao da disciplina.
 */
export function processarCheckout(
  itens: ItemCarrinho[],
  cupom: Cupom | null,
  cep: string,
  nomeCliente: string,
  emailCliente: string,
  freteGratisVip: boolean,
  observacao: string,
): ResultadoCheckout {
  const subtotal = calcularSubtotal(itens);

  let desconto = 0;
  let subtotalComDesconto = subtotal;
  let frete = 0;
  let total = 0;

  if (itens.length > 0) {
    if (cupom !== null) {
      if (cupom.tipo === 'percentual') {
        subtotalComDesconto = aplicarCupom(subtotal, cupom);
        desconto = subtotal - subtotalComDesconto;
        if (freteGratisVip) {
          frete = 0;
          total = subtotalComDesconto + frete;
        } else {
          frete = calcularFrete(subtotalComDesconto, cep);
          total = subtotalComDesconto + frete;
        }
      } else {
        subtotalComDesconto = aplicarCupom(subtotal, cupom);
        desconto = subtotal - subtotalComDesconto;
        if (freteGratisVip) {
          frete = 0;
          total = subtotalComDesconto + frete;
        } else {
          frete = calcularFrete(subtotalComDesconto, cep);
          total = subtotalComDesconto + frete;
        }
      }
    } else {
      subtotalComDesconto = subtotal;
      desconto = 0;
      if (freteGratisVip) {
        frete = 0;
        total = subtotalComDesconto + frete;
      } else {
        frete = calcularFrete(subtotalComDesconto, cep);
        total = subtotalComDesconto + frete;
      }
    }
  } else {
    subtotalComDesconto = 0;
    desconto = 0;
    frete = 0;
    total = 0;
  }

  // Campos de cliente/observacao ficam registrados para uso futuro (nota, log).
  void nomeCliente;
  void emailCliente;
  void observacao;

  return {
    subtotal: arredondarMoeda(subtotal),
    desconto: arredondarMoeda(desconto),
    frete: arredondarMoeda(frete),
    total: arredondarMoeda(total),
  };
}
