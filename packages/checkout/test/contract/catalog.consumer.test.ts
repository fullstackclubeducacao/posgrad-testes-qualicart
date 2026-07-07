// Teste do CONSUMIDOR do contrato (Pact) entre checkout e catalogo.
//
// O checkout consome GET /produtos/:sku do servico de catalogo. Aqui
// declaramos, de forma consumer-driven, QUAL a forma da resposta que o
// checkout precisa. O Pact sobe um mock server, roda o cliente real
// (`buscarProduto`) contra ele e, se tudo bater, gera o arquivo de pact
// em `pacts/` para ser verificado depois pelo provedor.
//
// Ponto didatico: usamos MATCHERS DE TIPO (string/number), nao valores
// fixos. O que importa e a FORMA do contrato, nao o dado especifico.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import type { Produto } from '../../src/catalog-client.ts';

const { string, number } = MatchersV3;

// Raiz do projeto -> pacts/ fica em <raiz>/pacts.
const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(aqui, '../../../..');
const PACT_DIR = path.join(RAIZ, 'pacts');

// Reimporta o cliente com a URL do mock ja aplicada em process.env.
// O cliente le CATALOG_URL no carregamento do modulo (const), por isso
// usamos um cache-buster no specifier para obter uma instancia fresca.
async function carregarClienteApontandoPara(url: string): Promise<{
  buscarProduto: (sku: string) => Promise<Produto>;
  ProdutoNaoEncontradoError: new (sku: string) => Error;
}> {
  process.env.CATALOG_URL = url;
  const mod = await import(`../../src/catalog-client.ts?v=${Date.now()}`);
  return mod;
}

function novoPact(): PactV3 {
  return new PactV3({
    consumer: 'qualicart-checkout',
    provider: 'qualicart-catalog',
    dir: PACT_DIR,
  });
}

test('GET /produtos/CAM-001 retorna um produto na forma esperada', async () => {
  const pact = novoPact();

  pact
    .uponReceiving('uma busca por um produto existente (CAM-001)')
    .withRequest({
      method: 'GET',
      path: '/produtos/CAM-001',
    })
    .willRespondWith({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      // Matchers de TIPO: o contrato exige a forma, nao o valor.
      body: {
        sku: string('CAM-001'),
        nome: string('Camiseta'),
        preco: number(59.9),
      },
    });

  await pact.executeTest(async (mockServer) => {
    const { buscarProduto } = await carregarClienteApontandoPara(mockServer.url);

    const produto = await buscarProduto('CAM-001');

    assert.equal(typeof produto.sku, 'string');
    assert.equal(typeof produto.nome, 'string');
    assert.equal(typeof produto.preco, 'number');
    assert.equal(produto.sku, 'CAM-001');
  });
});

test('GET /produtos/:sku inexistente responde 404 e lanca ProdutoNaoEncontradoError', async () => {
  const pact = novoPact();

  pact
    .uponReceiving('uma busca por um produto inexistente (INEXISTENTE-000)')
    .withRequest({
      method: 'GET',
      path: '/produtos/INEXISTENTE-000',
    })
    .willRespondWith({
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: {
        erro: string('Produto INEXISTENTE-000 nao encontrado'),
      },
    });

  await pact.executeTest(async (mockServer) => {
    const { buscarProduto, ProdutoNaoEncontradoError } =
      await carregarClienteApontandoPara(mockServer.url);

    await assert.rejects(
      () => buscarProduto('INEXISTENTE-000'),
      (erro: unknown) => {
        assert.ok(erro instanceof ProdutoNaoEncontradoError);
        assert.equal((erro as Error & { sku: string }).sku, 'INEXISTENTE-000');
        return true;
      },
    );
  });
});
