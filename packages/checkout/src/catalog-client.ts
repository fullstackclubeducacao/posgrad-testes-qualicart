// Cliente HTTP do servico de catalogo.
//
// Este e o CONSUMIDOR do contrato (Pact) entre checkout e catalogo.
// Formato esperado da resposta de /produtos/:sku:
//   { sku: string; nome: string; preco: number }

export type Produto = {
  sku: string;
  nome: string;
  preco: number;
};

const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:3001';

/**
 * Erro lancado quando o catalogo responde 404 para um SKU.
 */
export class ProdutoNaoEncontradoError extends Error {
  readonly sku: string;

  constructor(sku: string) {
    super(`Produto ${sku} nao encontrado no catalogo`);
    this.name = 'ProdutoNaoEncontradoError';
    this.sku = sku;
  }
}

/**
 * Busca um produto no servico de catalogo por HTTP.
 *
 * @throws {ProdutoNaoEncontradoError} quando o catalogo responde 404.
 * @throws {Error} para qualquer outra resposta nao-2xx (ex.: 503 chaos).
 */
export async function buscarProduto(sku: string): Promise<Produto> {
  const resposta = await fetch(`${CATALOG_URL}/produtos/${encodeURIComponent(sku)}`);

  if (resposta.status === 404) {
    throw new ProdutoNaoEncontradoError(sku);
  }

  if (!resposta.ok) {
    throw new Error(
      `Catalogo respondeu ${resposta.status} ao buscar o produto ${sku}`,
    );
  }

  const produto = (await resposta.json()) as Produto;
  return produto;
}
