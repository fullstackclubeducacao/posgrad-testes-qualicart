// Implementacao Postgres do repositorio de pedidos (lib `pg`).
//
// NOTA: enquanto `pg` nao estiver instalado, o typecheck pode acusar erro
// APENAS neste import. Este arquivo NAO e importado pelos testes de unidade;
// sera exercitado por um teste de integracao com testcontainers depois.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Pedido, PedidoRepository } from './pedido-repository.ts';

type LinhaPedido = {
  id: string;
  subtotal: string | number;
  desconto: string | number;
  frete: string | number;
  total: string | number;
  itens: Pedido['itens'];
  criado_em: Date | string;
};

export class PedidoRepositoryPostgres implements PedidoRepository {
  #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async salvar(pedido: Omit<Pedido, 'id' | 'criadoEm'>): Promise<Pedido> {
    const id = randomUUID();
    const resultado = await this.#pool.query<LinhaPedido>(
      `INSERT INTO pedidos (id, subtotal, desconto, frete, total, itens)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, subtotal, desconto, frete, total, itens, criado_em`,
      [
        id,
        pedido.subtotal,
        pedido.desconto,
        pedido.frete,
        pedido.total,
        JSON.stringify(pedido.itens),
      ],
    );

    const linha = resultado.rows[0];
    if (linha === undefined) {
      throw new Error('Falha ao inserir pedido');
    }
    return mapearLinha(linha);
  }

  async buscarPorId(id: string): Promise<Pedido | null> {
    const resultado = await this.#pool.query<LinhaPedido>(
      `SELECT id, subtotal, desconto, frete, total, itens, criado_em
       FROM pedidos
       WHERE id = $1`,
      [id],
    );

    const linha = resultado.rows[0];
    return linha === undefined ? null : mapearLinha(linha);
  }
}

function mapearLinha(linha: LinhaPedido): Pedido {
  return {
    id: linha.id,
    itens: linha.itens,
    subtotal: Number(linha.subtotal),
    desconto: Number(linha.desconto),
    frete: Number(linha.frete),
    total: Number(linha.total),
    criadoEm:
      linha.criado_em instanceof Date
        ? linha.criado_em.toISOString()
        : String(linha.criado_em),
  };
}
