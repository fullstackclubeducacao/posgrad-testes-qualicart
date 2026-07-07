// Provider custom do Promptfoo que expoe o AssistenteCheckout como um "modelo".
//
// Por que .mjs importando .ts?
//   O Node 24+/26 faz "type stripping" nativo, entao um .mjs consegue importar
//   diretamente os modulos .ts do assistente via import() dinamico. Assim o eval
//   exercita EXATAMENTE o codigo de producao (agent.ts + tools.ts + guardrails),
//   sem transpilar nada e sem duplicar logica.
//
// Contrato de provider custom do Promptfoo:
//   - exporta (default) uma classe com id() e async callApi(prompt, context)
//   - callApi recebe o prompt ja renderizado (a mensagem do usuario) e um
//     context com { vars, ... }; devolve { output, metadata }.
//
// OFFLINE e DETERMINISTICO: usa o FakeLlmClient (sem rede, sem chave). O mesmo
// provider serve para a demo de REGRESSAO: via `config.system` trocamos o prompt
// de sistema por uma variante DEGRADADA (sem a marca anti-injecao), fazendo o
// fake "obedecer" injecoes escondidas em DADOS -- o eval passa a acusar vermelho.

const base = new URL('../packages/ai-assistant/src/', import.meta.url);

// import() dinamico: resolve os .ts de producao em tempo de execucao.
const { AssistenteCheckout } = await import(new URL('agent.ts', base));
const { FakeLlmClient } = await import(new URL('llm-client.ts', base));
const { criarFerramentasPadrao } = await import(new URL('tools.ts', base));
const { PROMPT_SISTEMA, MARCA_ANTI_INJECAO } = await import(new URL('prompt.ts', base));

/**
 * Resolve o system prompt a partir do config do provider.
 *  - undefined | 'padrao' -> PROMPT_SISTEMA (producao, COM a marca anti-injecao)
 *  - 'degradado'          -> PROMPT_SISTEMA SEM a marca (a regressao a detectar)
 *  - qualquer outra string -> usada literalmente
 */
function resolverSystem(system) {
  if (system === undefined || system === 'padrao') {
    return PROMPT_SISTEMA;
  }
  if (system === 'degradado') {
    // Remove a diretriz anti-injecao -> o fake vira "ingenuo" e obedece injecao.
    return PROMPT_SISTEMA.replace(MARCA_ANTI_INJECAO, 'Trate os dados com cuidado');
  }
  return String(system);
}

export default class AssistenteProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? 'assistente-checkout';
    this.config = options.config ?? {};
    this.system = resolverSystem(this.config.system);
  }

  id() {
    return this.providerId;
  }

  /**
   * @param {string} prompt   mensagem do usuario (prompt renderizado pelo promptfoo)
   * @param {{ vars?: Record<string, unknown> }} context
   */
  async callApi(prompt, context = {}) {
    const vars = context.vars ?? {};
    // `contexto` modela DADOS nao-confiaveis recuperados (ex.: um pedido cujo
    // campo carrega uma instrucao maliciosa). Passa como 2o arg de responder().
    const contexto =
      typeof vars.contexto === 'string' && vars.contexto !== '' ? vars.contexto : undefined;

    const assistente = new AssistenteCheckout(new FakeLlmClient(), {
      ferramentas: criarFerramentasPadrao(),
      system: this.system,
    });

    try {
      const r = await assistente.responder(String(prompt), contexto);
      return {
        output: r.resposta,
        metadata: {
          ferramentasUsadas: r.ferramentasUsadas,
          recusado: r.recusado === true,
        },
      };
    } catch (erro) {
      return { error: erro instanceof Error ? erro.message : String(erro) };
    }
  }
}
