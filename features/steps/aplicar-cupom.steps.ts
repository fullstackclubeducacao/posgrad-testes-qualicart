import assert from 'node:assert/strict';
import { Given as Dado, When as Quando, Then as Então } from '@cucumber/cucumber';
import { calcularSubtotal } from '../../packages/checkout/src/cart.ts';
import { aplicarCupom } from '../../packages/checkout/src/coupon.ts';
import type { ItemCarrinho } from '../../packages/checkout/src/cart.ts';
import type { Cupom } from '../../packages/checkout/src/coupon.ts';

type Contexto = {
  subtotal: number;
  total: number;
};

function novoItem(precoUnitario: number): ItemCarrinho {
  return {
    sku: 'SKU-1',
    nome: 'Item de teste',
    precoUnitario,
    quantidade: 1,
  };
}

Dado('um carrinho com um item de cem reais', function (this: Contexto) {
  this.subtotal = calcularSubtotal([novoItem(100)]);
});

Dado('um carrinho com um item de {string} reais', function (this: Contexto, preco: string) {
  this.subtotal = calcularSubtotal([novoItem(Number(preco))]);
});

Quando('aplico um cupom percentual de dez por cento', function (this: Contexto) {
  const cupom: Cupom = { tipo: 'percentual', valor: 10 };
  this.total = aplicarCupom(this.subtotal, cupom);
});

Quando(
  'aplico um cupom {string} de {string}',
  function (this: Contexto, tipo: string, valor: string) {
    const cupom: Cupom =
      tipo === 'percentual'
        ? { tipo: 'percentual', valor: Number(valor) }
        : { tipo: 'fixo', valor: Number(valor) };
    this.total = aplicarCupom(this.subtotal, cupom);
  },
);

Então('o total é noventa reais', function (this: Contexto) {
  assert.equal(this.total, 90);
});

Então('o total é {string} reais', function (this: Contexto, total: string) {
  assert.equal(this.total, Number(total));
});
