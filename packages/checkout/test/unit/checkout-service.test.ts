import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { finalizarCheckout } from '../../src/checkout-service.ts';
import { PedidoRepositoryMemoria } from '../../src/pedido-repository.ts';
import type { Produto } from '../../src/catalog-client.ts';

// Catalog-client fake: sem rede, precos fixos em memoria.
const CATALOGO: Record<string, Produto> = {
  'CAM-001': { sku: 'CAM-001', nome: 'Camiseta', preco: 59.9 },
  'CAN-001': { sku: 'CAN-001', nome: 'Caneca', preco: 39.9 },
};

async function buscarProdutoFake(sku: string): Promise<Produto> {
  const produto = CATALOGO[sku];
  if (produto === undefined) {
    throw new Error(`fake: ${sku} nao encontrado`);
  }
  return produto;
}

describe('finalizarCheckout (com catalog-client fake e repo em memoria)', () => {
  it('resolve precos, calcula valores e persiste o pedido', async () => {
    const repo = new PedidoRepositoryMemoria();

    const pedido = await finalizarCheckout(
      {
        itens: [
          { sku: 'CAM-001', quantidade: 2 },
          { sku: 'CAN-001', quantidade: 1 },
        ],
        cupom: { tipo: 'percentual', valor: 10 },
        cep: '01000-000',
      },
      repo,
      buscarProdutoFake,
    );

    assert.equal(pedido.subtotal, 159.7);
    assert.ok(pedido.desconto > 0);
    assert.ok(typeof pedido.id === 'string' && pedido.id.length > 0);
    assert.equal(pedido.itens.length, 2);

    const recuperado = await repo.buscarPorId(pedido.id);
    assert.deepEqual(recuperado, pedido);
  });

  it('propaga erro quando o catalogo nao encontra o produto', async () => {
    const repo = new PedidoRepositoryMemoria();
    await assert.rejects(
      finalizarCheckout(
        { itens: [{ sku: 'XXX-000', quantidade: 1 }], cep: '01000-000' },
        repo,
        buscarProdutoFake,
      ),
    );
  });
});
