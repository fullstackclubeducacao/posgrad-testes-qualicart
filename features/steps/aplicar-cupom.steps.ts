import assert from 'node:assert/strict';
import { Given as Dado, When as Quando, Then as Então } from '@cucumber/cucumber';
import { calcularSubtotal } from '../../packages/checkout/src/cart.ts';
import { aplicarCupom } from '../../packages/checkout/src/coupon.ts';
import type { ItemCarrinho } from '../../packages/checkout/src/cart.ts';
import type { Cupom } from '../../packages/checkout/src/coupon.ts';

// O "World" do Cucumber: uma instancia nova por cenario, compartilhada entre
// os passos via `this`. E por aqui que o Dado passa dados para o Quando, e o
// Quando para o Entao.
type Contexto = {
  subtotal: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function novoItem(precoUnitario: number): ItemCarrinho {
  return {
    sku: 'SKU-1',
    nome: 'Item de teste',
    precoUnitario,
    quantidade: 1,
  };
}

function novoCupom(tipo: string, valor: string): Cupom {
  return tipo === 'percentual'
    ? { tipo: 'percentual', valor: Number(valor) }
    : { tipo: 'fixo', valor: Number(valor) };
}

// ---------------------------------------------------------------------------
// Cenario: "Aplicar um cupom percentual de dez por cento"
// Passos em linguagem natural, sem parametros — leitura de negocio.
// Ordem de execucao: Dado -> Quando -> Entao.
// ---------------------------------------------------------------------------

Dado('um carrinho com um item de cem reais', function (this: Contexto) {
  // Arrange: monta o estado inicial e guarda o subtotal no World.
  this.subtotal = calcularSubtotal([novoItem(100)]);
});

Quando('aplico um cupom percentual de dez por cento', function (this: Contexto) {
  // Act: executa a acao sob teste sobre o estado deixado pelo Dado.
  this.total = aplicarCupom(this.subtotal, { tipo: 'percentual', valor: 10 });
});

Então('o total é noventa reais', function (this: Contexto) {
  // Assert: verifica o resultado registrado pelo Quando.
  assert.equal(this.total, 90);
});

// ---------------------------------------------------------------------------
// Esquema do Cenario: "Aplicar cupons de diferentes tipos"
// Mesma trilha Dado -> Quando -> Entao, mas parametrizada: o Cucumber roda
// este bloco uma vez por linha da tabela de Exemplos, com World limpo a cada
// linha.
// ---------------------------------------------------------------------------

Dado('um carrinho com um item de {string} reais', function (this: Contexto, preco: string) {
  this.subtotal = calcularSubtotal([novoItem(Number(preco))]);
});

Quando(
  'aplico um cupom {string} de {string}',
  function (this: Contexto, tipo: string, valor: string) {
    this.total = aplicarCupom(this.subtotal, novoCupom(tipo, valor));
  },
);

Então('o total é {string} reais', function (this: Contexto, total: string) {
  assert.equal(this.total, Number(total));
});
