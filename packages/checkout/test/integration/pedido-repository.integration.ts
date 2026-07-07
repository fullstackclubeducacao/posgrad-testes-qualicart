// Teste de integracao REAL: sobe um Postgres em contêiner (testcontainers),
// aplica a migracao (schema.sql) e exercita a PedidoRepositoryPostgres de
// verdade — sem mock de banco.
//
// Requer Docker rodando. A primeira execucao pode demorar (pull da imagem).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { PedidoRepositoryPostgres } from '../../src/pedido-repository-postgres.ts';
import type { ItemPedido } from '../../src/pedido-repository.ts';

const TIMEOUT = 120_000;

const POSTGRES_USER = 'qualicart';
const POSTGRES_PASSWORD = 'qualicart';
const POSTGRES_DB = 'qualicart_test';

const schemaPath = fileURLToPath(
  new URL('../../src/schema.sql', import.meta.url),
);

describe('PedidoRepositoryPostgres (integração com Postgres em contêiner)', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let repositorio: PedidoRepositoryPostgres;

  before(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER,
        POSTGRES_PASSWORD,
        POSTGRES_DB,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(
          /database system is ready to accept connections/,
          2,
        ),
      )
      .start();

    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      database: POSTGRES_DB,
    });

    // Migracao: aplica o DDL real do schema.sql no banco do contêiner.
    const ddl = await readFile(schemaPath, 'utf8');
    await pool.query(ddl);

    repositorio = new PedidoRepositoryPostgres(pool);
  }, { timeout: TIMEOUT });

  after(async () => {
    await pool?.end();
    await container?.stop();
  }, { timeout: TIMEOUT });

  const itens: ItemPedido[] = [
    { sku: 'SKU-1', nome: 'Teclado', precoUnitario: 199.9, quantidade: 2 },
    { sku: 'SKU-2', nome: 'Mouse', precoUnitario: 89.5, quantidade: 1 },
  ];

  it(
    'salvar() persiste o pedido e retorna id e criadoEm preenchidos',
    { timeout: TIMEOUT },
    async () => {
      const salvo = await repositorio.salvar({
        itens,
        subtotal: 489.3,
        desconto: 10,
        frete: 25,
        total: 504.3,
      });

      assert.ok(salvo.id, 'id deve estar preenchido');
      assert.equal(typeof salvo.id, 'string');
      assert.ok(salvo.criadoEm, 'criadoEm deve estar preenchido');
      assert.ok(
        !Number.isNaN(Date.parse(salvo.criadoEm)),
        'criadoEm deve ser uma data ISO válida',
      );

      assert.equal(salvo.subtotal, 489.3);
      assert.equal(salvo.desconto, 10);
      assert.equal(salvo.frete, 25);
      assert.equal(salvo.total, 504.3);
      assert.deepEqual(salvo.itens, itens);
    },
  );

  it(
    'buscarPorId() recupera o pedido salvo com os mesmos valores (round-trip, itens jsonb)',
    { timeout: TIMEOUT },
    async () => {
      const salvo = await repositorio.salvar({
        itens,
        subtotal: 489.3,
        desconto: 10,
        frete: 25,
        total: 504.3,
      });

      const encontrado = await repositorio.buscarPorId(salvo.id);

      assert.notEqual(encontrado, null);
      assert.deepEqual(encontrado, salvo);
      // Confirma explicitamente o round-trip do jsonb dos itens.
      assert.deepEqual(encontrado?.itens, itens);
    },
  );

  it(
    'buscarPorId() retorna null para id inexistente',
    { timeout: TIMEOUT },
    async () => {
      const encontrado = await repositorio.buscarPorId('id-inexistente');
      assert.equal(encontrado, null);
    },
  );
});
