import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calcularSubtotal } from '../../src/cart.ts';
import type { ItemCarrinho } from '../../src/cart.ts';

describe('calcularSubtotal', () => {
  it('retorna 0 para um carrinho vazio', () => {
    assert.equal(calcularSubtotal([]), 0);
  });

  it('calcula o subtotal de um unico item com quantidade 1', () => {
    const itens: ItemCarrinho[] = [
      { sku: 'A1', nome: 'Caneca', precoUnitario: 29.9, quantidade: 1 },
    ];
    assert.equal(calcularSubtotal(itens), 29.9);
  });

  it('multiplica preco unitario pela quantidade quando quantidade > 1', () => {
    const itens: ItemCarrinho[] = [
      { sku: 'A1', nome: 'Caneca', precoUnitario: 10, quantidade: 3 },
    ];
    assert.equal(calcularSubtotal(itens), 30);
  });

  it('soma o subtotal de multiplos itens com quantidades distintas', () => {
    const itens: ItemCarrinho[] = [
      { sku: 'A1', nome: 'Caneca', precoUnitario: 10, quantidade: 2 },
      { sku: 'B2', nome: 'Caderno', precoUnitario: 25, quantidade: 4 },
      { sku: 'C3', nome: 'Caneta', precoUnitario: 3.5, quantidade: 10 },
    ];
    assert.equal(calcularSubtotal(itens), 20 + 100 + 35);
  });

  it('lida com valores fracionarios preservando o total exato', () => {
    const itens: ItemCarrinho[] = [
      { sku: 'A1', nome: 'Item', precoUnitario: 1.5, quantidade: 2 },
      { sku: 'B2', nome: 'Item', precoUnitario: 0.25, quantidade: 4 },
    ];
    assert.equal(calcularSubtotal(itens), 4);
  });

  it('considera item com quantidade 0 como contribuicao nula', () => {
    const itens: ItemCarrinho[] = [
      { sku: 'A1', nome: 'Caneca', precoUnitario: 50, quantidade: 0 },
      { sku: 'B2', nome: 'Caderno', precoUnitario: 20, quantidade: 2 },
    ];
    assert.equal(calcularSubtotal(itens), 40);
  });
});
