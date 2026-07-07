// Guardrails: defesas de runtime em camadas.
//
//  1. Validacao de ENTRADA  -> detectarInjecao (dados do usuario nao-confiaveis)
//  2. Validacao de SAIDA     -> validarTotal / saidaEhSegura (formato/esc opo)
//  3. Guardrail de ESCOPO    -> foraDeEscopo
//  4. FALLBACK               -> MENSAGEM_FALLBACK / MENSAGEM_RECUSA
//
// Todas as funcoes sao puras e deterministicas, faceis de testar isoladamente.

/** Mensagem segura padrao quando o LLM falha, demora ou aluc ina formato. */
export const MENSAGEM_FALLBACK =
  'Desculpe, tive um problema para responder agora. Você pode tentar de novo ' +
  'ou reformular? Posso ajudar com produtos, cupons, o total do carrinho e o ' +
  'status de pedidos.';

/** Mensagem padrao de recusa (injecao/fora de escopo). */
export const MENSAGEM_RECUSA =
  'Não posso ajudar com isso. Meu escopo é produtos, cupons, o total do ' +
  'carrinho e o status de pedidos do QualiCart.';

// ---------------------------------------------------------------------------
// 1) Entrada: deteccao de injecao de prompt
// ---------------------------------------------------------------------------

// Padroes de injecao/jailbreak comuns (pt/en). Ancorados e simples para evitar
// ReDoS (nada de aninhamento de quantificadores).
const PADROES_INJECAO: RegExp[] = [
  /ignore\s+(as\s+|todas?\s+as\s+)?instru[çc][õo]es/i,
  /ignore\s+(all\s+)?(previous\s+)?instructions/i,
  /esque[çc]a\s+(tudo|as\s+instru)/i,
  /desconsidere\s+(as\s+)?instru/i,
  /aja\s+como\s+(se\s+)?/i,
  /finja\s+(que|ser)/i,
  /voc[êe]\s+agora\s+[eé]/i,
  /system\s*:/i,
  /novas?\s+instru[çc][õo]es/i,
  /revele\s+(o\s+)?(seu\s+)?prompt/i,
  /(exfiltr|vaz[ae]r)\s+/i,
  /disregard\s+(the\s+)?(above|previous)/i,
];

/**
 * Detecta tentativas de injecao de prompt em um texto de entrada (dados do
 * usuario ou dados recuperados). Retorna true se encontrar qualquer padrao.
 */
export function detectarInjecao(texto: string): boolean {
  if (typeof texto !== 'string' || texto === '') {
    return false;
  }
  return PADROES_INJECAO.some((re) => re.test(texto));
}

// ---------------------------------------------------------------------------
// 2) Saida: validacao de formato/valor
// ---------------------------------------------------------------------------

/** Valida que um total e' um numero finito >= 0. */
export function validarTotal(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

/**
 * Valida a saida textual final do agente. Rejeita saida vazia, nao-string ou
 * absurdamente longa (alucinacao/loop). Retorna a mensagem de fallback quando
 * a saida e' invalida, senao a propria saida (aparada).
 */
export function sanitizarSaida(texto: unknown): string {
  if (typeof texto !== 'string') {
    return MENSAGEM_FALLBACK;
  }
  const limpo = texto.trim();
  if (limpo === '' || limpo.length > 4000) {
    return MENSAGEM_FALLBACK;
  }
  return limpo;
}

// ---------------------------------------------------------------------------
// 3) Escopo / toxicidade (heuristica leve)
// ---------------------------------------------------------------------------

const TERMOS_INSEGUROS: RegExp[] = [
  /\b(bomba|explosivo|arma\s+de\s+fogo)\b/i,
  /\b(malware|ransomware|v[ií]rus\s+de\s+computador)\b/i,
];

/**
 * Barra saidas claramente inseguras. Retorna true se a saida contiver termos
 * perigosos (fora do escopo de um assistente de checkout).
 */
export function saidaInsegura(texto: string): boolean {
  return TERMOS_INSEGUROS.some((re) => re.test(texto));
}
