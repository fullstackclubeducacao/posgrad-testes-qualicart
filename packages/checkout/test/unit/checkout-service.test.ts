import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizarCheckout,
  CatalogoIndisponivelError,
} from '../../src/checkout-service.ts';
import { PedidoRepositoryMemoria } from '../../src/pedido-repository.ts';
import { recarregarFlags } from '../../src/flags.ts';
import { ProdutoNaoEncontradoError } from '../../src/catalog-client.ts';
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

describe('finalizarCheckout com a flag checkoutResiliente LIGADA', () => {
  beforeEach(() => {
    process.env.FLAGS = JSON.stringify({ checkoutResiliente: { enabled: true } });
    recarregarFlags();
  });

  afterEach(() => {
    delete process.env.FLAGS;
    recarregarFlags();
  });

  it('caminho feliz produz o MESMO resultado do modo sequencial', async () => {
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
    assert.equal(pedido.itens.length, 2);
  });

  it('faz 1 retry e tem sucesso numa falha transitoria', async () => {
    const repo = new PedidoRepositoryMemoria();
    let chamadas = 0;
    const flaky = async (sku: string): Promise<Produto> => {
      chamadas += 1;
      if (chamadas === 1) {
        throw new Error('503 transitorio');
      }
      return { sku, nome: 'Camiseta', preco: 10 };
    };
    const pedido = await finalizarCheckout(
      { itens: [{ sku: 'CAM-001', quantidade: 1 }], cep: '01000-000' },
      repo,
      flaky,
    );
    assert.equal(chamadas, 2);
    assert.equal(pedido.itens.length, 1);
  });

  it('falha fechado com CatalogoIndisponivelError apos esgotar o retry', async () => {
    const repo = new PedidoRepositoryMemoria();
    const sempreFalha = async (): Promise<Produto> => {
      throw new Error('503 persistente');
    };
    await assert.rejects(
      finalizarCheckout(
        { itens: [{ sku: 'CAM-001', quantidade: 1 }], cep: '01000-000' },
        repo,
        sempreFalha,
      ),
      CatalogoIndisponivelError,
    );
  });

  it('produto inexistente (404) NAO faz retry e propaga ProdutoNaoEncontradoError', async () => {
    const repo = new PedidoRepositoryMemoria();
    let chamadas = 0;
    const naoEncontrado = async (sku: string): Promise<Produto> => {
      chamadas += 1;
      throw new ProdutoNaoEncontradoError(sku);
    };
    await assert.rejects(
      finalizarCheckout(
        { itens: [{ sku: 'XXX-000', quantidade: 1 }], cep: '01000-000' },
        repo,
        naoEncontrado,
      ),
      ProdutoNaoEncontradoError,
    );
    assert.equal(chamadas, 1);
  });
});
