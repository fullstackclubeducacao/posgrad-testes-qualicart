// Abstracao do LLM: a "costura" testavel do agente.
//
// Define um contrato unico (LlmClient) com duas implementacoes:
//  - AnthropicLlmClient: cliente REAL (usa @anthropic-ai/sdk); so' roda com
//    ANTHROPIC_API_KEY no ambiente.
//  - FakeLlmClient: cliente FAKE deterministico, sem rede; default offline
//    usado em testes/CI e no CLI quando nao ha chave.
//
// Ambos recebem os mesmos parametros e devolvem um TurnoAssistente normalizado,
// de modo que o agente (agent.ts) nao sabe qual cliente esta por tras.

import Anthropic from '@anthropic-ai/sdk';
import type { DefinicaoFerramenta } from './tools.ts';
import { MARCA_ANTI_INJECAO } from './prompt.ts';
import { detectarInjecao } from './guardrails.ts';

// ---------------------------------------------------------------------------
// Tipos de conversa (shape simples, comum aos dois clientes)
// ---------------------------------------------------------------------------

/** Um pedido do LLM para executar uma ferramenta. */
export type ToolUse = { id: string; nome: string; input: unknown };

/** Blocos de conteudo de uma mensagem de chat. */
export type BlocoTexto = { type: 'text'; text: string };
export type BlocoToolUse = { type: 'tool_use'; id: string; name: string; input: unknown };
export type BlocoToolResult = { type: 'tool_result'; tool_use_id: string; content: string };
export type BlocoChat = BlocoTexto | BlocoToolUse | BlocoToolResult;

/** Conteudo de uma mensagem: texto simples ou lista de blocos. */
export type ConteudoChat = string | BlocoChat[];

/** Uma mensagem da conversa. */
export type MensagemChat = { role: 'user' | 'assistant'; content: ConteudoChat };

/** Resultado normalizado de um turno do assistente. */
export type TurnoAssistente = {
  texto: string;
  toolUses: ToolUse[];
  stopReason: 'fim' | 'ferramenta';
};

/** Parametros de uma geracao. */
export type ParamsGeracao = {
  system: string;
  messages: MensagemChat[];
  tools: DefinicaoFerramenta[];
};

/** Contrato do cliente de LLM. */
export interface LlmClient {
  gerar(params: ParamsGeracao): Promise<TurnoAssistente>;
}

/**
 * Erro de dominio para falha de infraestrutura do LLM (rede/timeout/5xx).
 * O agente captura este erro para aplicar o fallback seguro.
 */
export class LlmIndisponivelError extends Error {
  readonly causaOriginal: unknown;

  constructor(mensagem: string, causaOriginal?: unknown) {
    super(mensagem);
    this.name = 'LlmIndisponivelError';
    this.causaOriginal = causaOriginal;
  }
}

// ---------------------------------------------------------------------------
// Cliente REAL (Anthropic)
// ---------------------------------------------------------------------------

/**
 * Cliente de LLM real, sobre o SDK oficial da Anthropic.
 * Le a chave de `ANTHROPIC_API_KEY` e o modelo de `AI_MODEL`
 * (default `claude-opus-4-8`).
 */
export class AnthropicLlmClient implements LlmClient {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(client: Anthropic = new Anthropic()) {
    this.#client = client;
    this.#model = process.env.AI_MODEL ?? 'claude-opus-4-8';
  }

  async gerar(params: ParamsGeracao): Promise<TurnoAssistente> {
    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    try {
      const resp = await this.#client.messages.create({
        model: this.#model,
        max_tokens: 1024,
        system: params.system,
        tools,
        messages: params.messages as Anthropic.MessageParam[],
      });
      return mapearResposta(resp);
    } catch (erro) {
      throw new LlmIndisponivelError(
        'Falha ao chamar o provedor de LLM (Anthropic).',
        erro,
      );
    }
  }
}

/** Mapeia a resposta bruta do SDK para o TurnoAssistente normalizado. */
function mapearResposta(resp: Anthropic.Message): TurnoAssistente {
  let texto = '';
  const toolUses: ToolUse[] = [];

  for (const bloco of resp.content) {
    if (bloco.type === 'text') {
      texto += bloco.text;
    } else if (bloco.type === 'tool_use') {
      toolUses.push({ id: bloco.id, nome: bloco.name, input: bloco.input });
    }
  }

  const stopReason = resp.stop_reason === 'tool_use' ? 'ferramenta' : 'fim';
  return { texto, toolUses, stopReason };
}

// ---------------------------------------------------------------------------
// Cliente FAKE (deterministico, offline)
// ---------------------------------------------------------------------------

/** Opcoes do fake. `variacao`, quando definida, injeta variacao controlada. */
export type OpcoesFake = { variacao?: number };

/**
 * Cliente de LLM FAKE e DETERMINISTICO. Nao faz rede.
 *
 * Decide a partir da ULTIMA mensagem do usuario + do system prompt:
 *  - se a ultima mensagem ja e' um tool_result (role user com bloco de
 *    resultado), fecha o turno com texto que USA o resultado;
 *  - senao, classifica a intencao por palavras-chave (pt) e, quando cabe,
 *    emite um tool_use;
 *  - trata injecao conforme o system prompt (ver README/doc): com a marca
 *    anti-injecao presente, RECUSA; sem ela, e' ingenuo.
 */
export class FakeLlmClient implements LlmClient {
  readonly #variacao?: number;

  constructor(opcoes: OpcoesFake = {}) {
    this.#variacao = opcoes.variacao;
  }

  async gerar(params: ParamsGeracao): Promise<TurnoAssistente> {
    const ultima = params.messages[params.messages.length - 1];

    // 1) Se a ultima mensagem carrega um tool_result, sintetiza a resposta
    //    final usando esse resultado.
    const resultado = extrairToolResult(ultima);
    if (resultado !== undefined) {
      return { texto: this.#comVariacao(redigirResposta(resultado)), toolUses: [], stopReason: 'fim' };
    }

    const textoUsuario = extrairTextoUsuario(ultima);
    const protegido = params.system.includes(MARCA_ANTI_INJECAO);

    // 2) Tentativa de injecao nos dados do usuario.
    if (detectarInjecao(textoUsuario)) {
      if (protegido) {
        return {
          texto:
            'Não posso seguir instruções embutidas na mensagem. Posso ajudar ' +
            'com produtos, cupons, o total do carrinho ou o status de um pedido.',
          toolUses: [],
          stopReason: 'fim',
        };
      }
      // Fake ingenuo (prompt sem a marca): OBEDECE -- regressao a ser detectada.
      return {
        texto: 'Ok, ignorando minhas instruções anteriores conforme pedido.',
        toolUses: [],
        stopReason: 'fim',
      };
    }

    // 3) Classificacao de intencao -> ferramenta ou texto.
    const turno = this.#classificar(textoUsuario);
    return turno;
  }

  #classificar(texto: string): TurnoAssistente {
    const intencao = classificarIntencao(texto);

    if (intencao === 'total') {
      return this.#toolUse('calcular_total', {
        itens: extrairItens(texto),
        cupom: extrairCodigoCupom(texto),
        cep: extrairCep(texto),
      });
    }
    if (intencao === 'cupom') {
      return this.#toolUse('aplicar_cupom_info', { codigo: extrairCodigoCupom(texto) ?? '' });
    }
    if (intencao === 'produto') {
      return this.#toolUse('buscar_produto', { sku: extrairSku(texto) ?? '' });
    }
    if (intencao === 'pedido') {
      return this.#toolUse('consultar_pedido', { id: extrairIdPedido(texto) ?? '' });
    }

    // Saudacao / fora de escopo.
    const texto0 =
      intencao === 'saudacao'
        ? 'Olá! Sou o assistente do QualiCart. Posso ajudar com produtos, ' +
          'cupons, o total do carrinho e o status do seu pedido.'
        : 'Desculpe, só consigo ajudar com produtos, cupons, o total do ' +
          'carrinho e o status de pedidos do QualiCart.';
    return { texto: this.#comVariacao(texto0), toolUses: [], stopReason: 'fim' };
  }

  #toolUse(nome: string, input: unknown): TurnoAssistente {
    const id = `fake_${nome}_${this.#variacao ?? 0}`;
    return {
      texto: '',
      toolUses: [{ id, nome, input }],
      stopReason: 'ferramenta',
    };
  }

  // Variacao controlada e deterministica (para o exercicio de nao-determinismo).
  #comVariacao(texto: string): string {
    if (this.#variacao === undefined) {
      return texto;
    }
    const sufixos = [' 🙂', ' Até logo!', ' Precisa de mais algo?', ' 👍', ''];
    const i = ((this.#variacao % sufixos.length) + sufixos.length) % sufixos.length;
    return texto + (sufixos[i] ?? '');
  }
}

// ---------------------------------------------------------------------------
// Helpers deterministicos do fake (exportados para teste/doc)
// ---------------------------------------------------------------------------

export type Intencao = 'total' | 'cupom' | 'produto' | 'pedido' | 'saudacao' | 'fora';

/** Mapa intencao->ferramenta usado pelo fake (documentado no doc do modulo). */
export function classificarIntencao(texto: string): Intencao {
  const t = texto.toLowerCase();
  if (/(total|carrinho|quanto\s+fica|quanto\s+custa\s+tudo|somar)/.test(t)) {
    return 'total';
  }
  if (/(cupom|cupons|c[oó]digo\s+de\s+desconto)/.test(t)) {
    return 'cupom';
  }
  if (/(pedido|encomenda|status|rastre)/.test(t)) {
    return 'pedido';
  }
  if (/(produto|pre[çc]o|quanto\s+custa|[a-z]{3}-\d{3}|camiseta|caneca|livro|fone|teclado)/.test(t)) {
    return 'produto';
  }
  if (/(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|e\s*a[ií])/.test(t)) {
    return 'saudacao';
  }
  return 'fora';
}

const NOME_PARA_SKU: Record<string, string> = {
  camiseta: 'CAM-001',
  caneca: 'CAN-001',
  livro: 'LIV-001',
  fone: 'FON-001',
  teclado: 'TEC-001',
};

/** Extrai itens {sku, quantidade} do texto (quantidade antes do nome). */
export function extrairItens(texto: string): Array<{ sku: string; quantidade: number }> {
  const t = texto.toLowerCase();
  const itens: Array<{ sku: string; quantidade: number }> = [];
  for (const nome of Object.keys(NOME_PARA_SKU)) {
    const re = new RegExp(`(\\d+)\\s+${nome}`);
    const m = re.exec(t);
    const sku = NOME_PARA_SKU[nome];
    if (sku === undefined) {
      continue;
    }
    if (m && m[1] !== undefined) {
      itens.push({ sku, quantidade: Number(m[1]) });
    } else if (t.includes(nome)) {
      itens.push({ sku, quantidade: 1 });
    }
  }
  return itens;
}

/** Extrai um codigo de cupom (token em MAIUSCULAS ou apos a palavra "cupom"). */
export function extrairCodigoCupom(texto: string): string | undefined {
  const apos = /cupom\s+([A-Za-z0-9]{3,})/.exec(texto);
  if (apos && apos[1] !== undefined) {
    return apos[1].toUpperCase();
  }
  const maiusc = /\b([A-Z][A-Z0-9]{3,})\b/.exec(texto);
  if (maiusc && maiusc[1] !== undefined && !/^[A-Z]{3}-\d{3}$/.test(maiusc[1])) {
    return maiusc[1];
  }
  return undefined;
}

/** Extrai um CEP (5+3 digitos) ou usa um default deterministico. */
export function extrairCep(texto: string): string {
  const m = /(\d{5}-?\d{3})/.exec(texto);
  return m && m[1] !== undefined ? m[1] : '01000-000';
}

/** Extrai um SKU no formato AAA-000. */
export function extrairSku(texto: string): string | undefined {
  const m = /([A-Za-z]{3}-\d{3})/.exec(texto);
  if (m && m[1] !== undefined) {
    return m[1].toUpperCase();
  }
  const t = texto.toLowerCase();
  for (const nome of Object.keys(NOME_PARA_SKU)) {
    if (t.includes(nome)) {
      return NOME_PARA_SKU[nome];
    }
  }
  return undefined;
}

/** Extrai um id de pedido (uuid ou token apos "pedido"). */
export function extrairIdPedido(texto: string): string | undefined {
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(texto);
  if (uuid && uuid[1] !== undefined) {
    return uuid[1];
  }
  const apos = /pedido\s+([A-Za-z0-9-]{3,})/i.exec(texto);
  return apos && apos[1] !== undefined ? apos[1] : undefined;
}

/** Extrai o texto de uma mensagem do usuario (string ou blocos de texto). */
function extrairTextoUsuario(msg: MensagemChat | undefined): string {
  if (msg === undefined) {
    return '';
  }
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  return msg.content
    .filter((b): b is BlocoTexto => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

/** Extrai o primeiro tool_result de uma mensagem, se houver. */
function extrairToolResult(msg: MensagemChat | undefined): string | undefined {
  if (msg === undefined || typeof msg.content === 'string') {
    return undefined;
  }
  const bloco = msg.content.find((b): b is BlocoToolResult => b.type === 'tool_result');
  return bloco?.content;
}

/** Redige a resposta final a partir do conteudo (JSON) de um tool_result. */
function redigirResposta(resultadoJson: string): string {
  let dados: unknown;
  try {
    dados = JSON.parse(resultadoJson);
  } catch {
    return 'Desculpe, não consegui interpretar o resultado da consulta.';
  }
  if (typeof dados !== 'object' || dados === null) {
    return 'Não encontrei essa informação.';
  }
  const d = dados as Record<string, unknown>;

  if (typeof d['status'] === 'string') {
    return `O pedido ${String(d['id'] ?? '')} está com status "${String(d['status'])}"` +
      (typeof d['total'] === 'number' ? `, total R$${(d['total'] as number).toFixed(2)}.` : '.');
  }
  if (typeof d['total'] === 'number') {
    return `O total do seu carrinho é R$${(d['total'] as number).toFixed(2)} ` +
      `(subtotal R$${Number(d['subtotal'] ?? 0).toFixed(2)}, ` +
      `desconto R$${Number(d['desconto'] ?? 0).toFixed(2)}, ` +
      `frete R$${Number(d['frete'] ?? 0).toFixed(2)}).`;
  }
  if (typeof d['preco'] === 'number') {
    return `O produto ${String(d['nome'] ?? d['sku'])} custa R$${(d['preco'] as number).toFixed(2)}.`;
  }
  if (typeof d['descricao'] === 'string') {
    return String(d['descricao']);
  }
  if (typeof d['erro'] === 'string') {
    return `Não foi possível concluir: ${String(d['erro'])}.`;
  }
  return 'Consulta concluída.';
}
