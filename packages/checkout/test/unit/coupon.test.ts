import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarCupom } from '../../src/coupon.ts';

describe('aplicarCupom', () => {
  it('aplica o cupom quando o subtotal atinge EXATAMENTE o mínimo do carrinho', () => {
    // Fronteira: o mínimo do cupom é R$100 e o carrinho tem exatamente R$100.
    // A regra correta é "mínimo atingido" (>=), então o desconto deve valer.
    const comDesconto = aplicarCupom(100, {
      tipo: 'percentual',
      valor: 10,
      minimoCarrinho: 100,
    });

    assert.equal(comDesconto, 90);
  });
});
