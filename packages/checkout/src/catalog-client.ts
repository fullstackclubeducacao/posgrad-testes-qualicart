// Cliente HTTP do servico de catalogo.
//
// Este e o CONSUMIDOR do contrato (Pact) entre checkout e catalogo.
// Formato esperado da resposta de /produtos/:sku:
//   { sku: string; nome: string; preco: number }

import { trace, context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Tracer manual: sob Node nativo (ESM) a auto-instrumentacao de http/undici
// nao engancha, entao criamos o span CLIENT explicitamente e propagamos o
// contexto W3C (`traceparent`) injetando os headers do fetch.
const tracer = trace.getTracer('qualicart-checkout');

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
  return tracer.startActiveSpan(
    'GET /produtos/:sku',
    { kind: SpanKind.CLIENT },
    async (span) => {
      span.setAttribute('http.request.method', 'GET');
      span.setAttribute('url.full', `${CATALOG_URL}/produtos/${sku}`);
      span.setAttribute('catalog.sku', sku);

      // Propagacao W3C manual: injeta `traceparent` no contexto ativo -> headers.
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);

      try {
        const resposta = await fetch(
          `${CATALOG_URL}/produtos/${encodeURIComponent(sku)}`,
          { headers },
        );
        span.setAttribute('http.response.status_code', resposta.status);

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
      } catch (erro) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: erro instanceof Error ? erro.message : String(erro),
        });
        throw erro;
      } finally {
        span.end();
      }
    },
  );
}
