// Catalogo de produtos em memoria (fonte de precos do servico de catalogo).

import type { Produto } from './produto.ts';

const CATALOGO: Produto[] = [
  { sku: 'CAM-001', nome: 'Camiseta', preco: 59.9 },
  { sku: 'CAN-001', nome: 'Caneca', preco: 39.9 },
  { sku: 'LIV-001', nome: 'Livro', preco: 89.9 },
  { sku: 'FON-001', nome: 'Fone', preco: 199.9 },
  { sku: 'TEC-001', nome: 'Teclado', preco: 249.9 },
];

/**
 * Busca um produto pelo SKU. Retorna `undefined` se nao existir.
 */
export function buscarProduto(sku: string): Produto | undefined {
  return CATALOGO.find((produto) => produto.sku === sku);
}

/**
 * Lista todos os produtos do catalogo.
 */
export function listarProdutos(): Produto[] {
  return [...CATALOGO];
}
