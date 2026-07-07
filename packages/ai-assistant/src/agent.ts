// O agente: orquestra o loop agentico + defesas de runtime + contencao.
//
// Contencao arquitetural aplicada aqui:
//  - MENOR PRIVILEGIO: so' expoe ferramentas read-only (ver tools.ts).
//  - ENTRADA NAO-CONFIAVEL: a mensagem do usuario passa por detectarInjecao
//    ANTES de qualquer ferramenta; se suspeita, o agente recusa e nao obedece.
//  - LIMITE DE ITERACOES: o loop tem teto (MAX_ITERACOES) contra loop infinito.
//  - CONFIRMACAO HUMANA: acoes de alto impacto nao sao expostas (ver tools.ts).
//  - FALLBACK: qualquer falha do LLM vira mensagem segura (nunca propaga).

import { EXECUTORES, FERRAMENTAS, criarFerramentasPadrao } from './tools.ts';
import {
  MENSAGEM_FALLBACK,
  MENSAGEM_RECUSA,
  detectarInjecao,
  saidaInsegura,
  sanitizarSaida,
} from './guardrails.ts';
import { PROMPT_SISTEMA } from './prompt.ts';
import type { LlmClient, MensagemChat, BlocoChat } from './llm-client.ts';
import type { Ferramentas } from './tools.ts';

const MAX_ITERACOES = 5;

export type RespostaAgente = {
  resposta: string;
  ferramentasUsadas: string[];
  recusado?: boolean;
};

export type OpcoesAgente = {
  ferramentas?: Ferramentas;
  system?: string;
};

/** Assistente de checkout: agente com tool use, guardrails e contencao. */
export class AssistenteCheckout {
  readonly #llm: LlmClient;
  readonly #ferramentas: Ferramentas;
  readonly #system: string;

  constructor(llm: LlmClient, opcoes: OpcoesAgente = {}) {
    this.#llm = llm;
    this.#ferramentas = opcoes.ferramentas ?? criarFerramentasPadrao();
    this.#system = opcoes.system ?? PROMPT_SISTEMA;
  }

  /**
   * Responde a uma mensagem do usuario, rodando o loop agentico e aplicando as
   * defesas. Nunca lanca excecao para o chamador: falhas viram fallback.
   */
  async responder(mensagemUsuario: string, contexto?: string): Promise<RespostaAgente> {
    // 1) Guardrail de ENTRADA: dados do mundo sao nao-confiaveis.
    if (detectarInjecao(mensagemUsuario)) {
      return { resposta: MENSAGEM_RECUSA, ferramentasUsadas: [], recusado: true };
    }

    const conteudoInicial = contexto
      ? `${contexto}\n\n${mensagemUsuario}`
      : mensagemUsuario;
    const messages: MensagemChat[] = [{ role: 'user', content: conteudoInicial }];
    const ferramentasUsadas: string[] = [];

    try {
      return await this.#loop(messages, ferramentasUsadas);
    } catch {
      // 4) FALLBACK: qualquer falha (LLM indisponivel, formato, etc.).
      return { resposta: MENSAGEM_FALLBACK, ferramentasUsadas, recusado: false };
    }
  }

  async #loop(
    messages: MensagemChat[],
    ferramentasUsadas: string[],
  ): Promise<RespostaAgente> {
    for (let i = 0; i < MAX_ITERACOES; i++) {
      const turno = await this.#llm.gerar({
        system: this.#system,
        messages,
        tools: FERRAMENTAS,
      });

      if (turno.stopReason === 'fim' || turno.toolUses.length === 0) {
        return this.#finalizar(turno.texto, ferramentasUsadas);
      }

      // Registra o turno do assistente (com os tool_use) na conversa.
      const blocosAssistente: BlocoChat[] = turno.toolUses.map((tu) => ({
        type: 'tool_use',
        id: tu.id,
        name: tu.nome,
        input: tu.input,
      }));
      messages.push({ role: 'assistant', content: blocosAssistente });

      // Executa cada ferramenta pedida e anexa os tool_result.
      const blocosResultado: BlocoChat[] = [];
      for (const tu of turno.toolUses) {
        const resultado = await this.#executar(tu.nome, tu.input);
        ferramentasUsadas.push(tu.nome);
        blocosResultado.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(resultado),
        });
      }
      messages.push({ role: 'user', content: blocosResultado });
    }

    // Estourou o limite de iteracoes -> fallback seguro.
    return { resposta: MENSAGEM_FALLBACK, ferramentasUsadas, recusado: false };
  }

  async #executar(nome: string, input: unknown): Promise<Record<string, unknown>> {
    const executor = EXECUTORES[nome];
    if (executor === undefined) {
      return { erro: `Ferramenta desconhecida: ${nome}` };
    }
    try {
      return await executor(input, this.#ferramentas);
    } catch (erro) {
      return { erro: erro instanceof Error ? erro.message : 'falha na ferramenta' };
    }
  }

  // 2/3) Guardrail de SAIDA + escopo/seguranca.
  #finalizar(texto: string, ferramentasUsadas: string[]): RespostaAgente {
    const limpo = sanitizarSaida(texto);
    if (saidaInsegura(limpo)) {
      return { resposta: MENSAGEM_RECUSA, ferramentasUsadas, recusado: true };
    }
    return { resposta: limpo, ferramentasUsadas };
  }
}
