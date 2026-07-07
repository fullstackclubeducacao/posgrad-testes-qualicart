import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buscarProduto, listarProdutos } from '../../src/products.ts';

describe('products', () => {
  it('busca um produto existente pelo SKU', () => {
    const produto = buscarProduto('CAM-001');
    assert.deepEqual(produto, { sku: 'CAM-001', nome: 'Camiseta', preco: 59.9 });
  });

  it('retorna undefined para SKU inexistente', () => {
    assert.equal(buscarProduto('XXX-000'), undefined);
  });

  it('lista todos os produtos do catalogo', () => {
    const produtos = listarProdutos();
    assert.ok(produtos.length >= 5);
    assert.ok(produtos.every((p) => typeof p.sku === 'string' && typeof p.preco === 'number'));
  });
});
