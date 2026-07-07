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

  it('não aplica o cupom quando o subtotal fica abaixo do mínimo', () => {
    const semDesconto = aplicarCupom(99.99, {
      tipo: 'percentual',
      valor: 10,
      minimoCarrinho: 100,
    });

    assert.equal(semDesconto, 99.99);
  });

  it('aplica o cupom quando o subtotal supera o mínimo', () => {
    const comDesconto = aplicarCupom(200, {
      tipo: 'percentual',
      valor: 10,
      minimoCarrinho: 100,
    });

    assert.equal(comDesconto, 180);
  });

  it('aplica desconto percentual quando não há mínimo definido', () => {
    const comDesconto = aplicarCupom(80, { tipo: 'percentual', valor: 25 });

    assert.equal(comDesconto, 60);
  });

  it('aplica desconto fixo quando não há mínimo definido', () => {
    const comDesconto = aplicarCupom(80, { tipo: 'fixo', valor: 30 });

    assert.equal(comDesconto, 50);
  });

  it('nunca deixa o total negativo com cupom fixo maior que o subtotal', () => {
    const comDesconto = aplicarCupom(20, { tipo: 'fixo', valor: 50 });

    assert.equal(comDesconto, 0);
  });

  it('respeita o mínimo também para cupom fixo', () => {
    const semDesconto = aplicarCupom(40, {
      tipo: 'fixo',
      valor: 10,
      minimoCarrinho: 50,
    });

    assert.equal(semDesconto, 40);
  });
});
