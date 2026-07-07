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
 * Opcoes da busca de produto. `timeoutMs`, quando fornecido, aborta o fetch
 * apos o prazo (via AbortController) -- usado pelo caminho resiliente do
 * checkout para nao ficar preso a uma dependencia lenta.
 */
export type BuscarProdutoOpcoes = {
  timeoutMs?: number;
};

/**
 * Busca um produto no servico de catalogo por HTTP.
 *
 * A assinatura antiga (`buscarProduto(sku)`) continua valida; o segundo
 * parametro e' opcional e retrocompativel.
 *
 * @throws {ProdutoNaoEncontradoError} quando o catalogo responde 404.
 * @throws {Error} para qualquer outra resposta nao-2xx (ex.: 503 chaos) ou
 *   quando o timeout aborta a chamada (`AbortError`).
 */
export async function buscarProduto(
  sku: string,
  opcoes: BuscarProdutoOpcoes = {},
): Promise<Produto> {
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

      // Timeout opcional: aborta o fetch se o catalogo demorar demais.
      const { timeoutMs } = opcoes;
      const controlador =
        timeoutMs !== undefined ? new AbortController() : undefined;
      const timer =
        controlador !== undefined
          ? setTimeout(() => controlador.abort(), timeoutMs)
          : undefined;

      try {
        const resposta = await fetch(
          `${CATALOG_URL}/produtos/${encodeURIComponent(sku)}`,
          { headers, signal: controlador?.signal },
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
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        span.end();
      }
    },
  );
}
