// Testes baseados em propriedades (property-based) para o nucleo de precos.
//
// Ao inves de exemplos fixos, declaramos INVARIANTES que devem valer para
// QUALQUER entrada. O fast-check gera centenas de casos aleatorios (incluindo
// fronteiras e valores "estranhos") tentando refutar cada propriedade.

import { describe, it } from 'node:test';
import fc from 'fast-check';

import { aplicarCupom } from '../../src/coupon.ts';
import { calcularSubtotal } from '../../src/cart.ts';
import type { ItemCarrinho } from '../../src/cart.ts';

const TOLERANCIA = 1e-9;

// Subtotais nao-negativos, finitos e sem exageros que estourem a precisao.
const subtotalArb = fc.double({
  min: 0,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

// Item de carrinho com preco e quantidade nao-negativos e finitos.
const itemArb: fc.Arbitrary<ItemCarrinho> = fc.record({
  sku: fc.string(),
  nome: fc.string(),
  precoUnitario: fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }),
  quantidade: fc.nat({ max: 100 }),
});

describe('propriedades de aplicarCupom (percentual)', () => {
  it('o resultado permanece sempre dentro de [0, subtotal] para qualquer percentual 0..100', () => {
    fc.assert(
      fc.property(
        subtotalArb,
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        (subtotal, percentual) => {
          const resultado = aplicarCupom(subtotal, {
            tipo: 'percentual',
            valor: percentual,
          });

          // Nunca fica negativo (com folga de ponto flutuante).
          return resultado >= -TOLERANCIA && resultado <= subtotal + TOLERANCIA;
        },
      ),
    );
  });
});

describe('propriedades de aplicarCupom (fixo)', () => {
  it('o resultado nunca fica negativo e nunca supera o subtotal (piso em 0)', () => {
    fc.assert(
      fc.property(
        subtotalArb,
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (subtotal, valorFixo) => {
          const resultado = aplicarCupom(subtotal, {
            tipo: 'fixo',
            valor: valorFixo,
          });

          return resultado >= -TOLERANCIA && resultado <= subtotal + TOLERANCIA;
        },
      ),
    );
  });
});

describe('propriedades de calcularSubtotal', () => {
  it('o subtotal e sempre >= 0 para itens com preco e quantidade nao-negativos', () => {
    fc.assert(
      fc.property(fc.array(itemArb), (itens) => {
        return calcularSubtotal(itens) >= -TOLERANCIA;
      }),
    );
  });

  it('e aditivo: subtotal(A concatenado com B) == subtotal(A) + subtotal(B)', () => {
    fc.assert(
      fc.property(fc.array(itemArb), fc.array(itemArb), (a, b) => {
        const juntos = calcularSubtotal([...a, ...b]);
        const separados = calcularSubtotal(a) + calcularSubtotal(b);

        // Tolerancia relativa: a soma de floats nao e associativa, entao a
        // ordem de acumulacao introduz um erro proporcional a magnitude.
        const escala = Math.max(1, Math.abs(juntos), Math.abs(separados));
        return Math.abs(juntos - separados) < TOLERANCIA * escala;
      }),
    );
  });
});
