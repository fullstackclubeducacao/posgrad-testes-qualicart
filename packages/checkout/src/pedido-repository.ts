// Persistencia de pedidos: contrato e implementacao em memoria (default).

import { randomUUID } from 'node:crypto';

export type ItemPedido = {
  sku: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
};

export type Pedido = {
  id: string;
  itens: ItemPedido[];
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  criadoEm: string;
};

export interface PedidoRepository {
  salvar(pedido: Omit<Pedido, 'id' | 'criadoEm'>): Promise<Pedido>;
  buscarPorId(id: string): Promise<Pedido | null>;
}

/**
 * Implementacao em memoria do repositorio de pedidos.
 * Default para rodar o servico sem banco de dados.
 */
export class PedidoRepositoryMemoria implements PedidoRepository {
  #pedidos = new Map<string, Pedido>();

  async salvar(pedido: Omit<Pedido, 'id' | 'criadoEm'>): Promise<Pedido> {
    const persistido: Pedido = {
      ...pedido,
      id: randomUUID(),
      criadoEm: new Date().toISOString(),
    };
    this.#pedidos.set(persistido.id, persistido);
    return persistido;
  }

  async buscarPorId(id: string): Promise<Pedido | null> {
    return this.#pedidos.get(id) ?? null;
  }
}
