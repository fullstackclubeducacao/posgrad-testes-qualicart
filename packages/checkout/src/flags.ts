// Feature flags simples e testaveis para o QualiCart (Modulo 3).
//
// Desacopla DEPLOY (o codigo dos dois caminhos ja esta em producao) de RELEASE
// (qual caminho cada requisicao executa). Ligar/desligar uma flag e' uma
// mudanca de CONFIGURACAO -> reversao em segundos, sem novo build/deploy.
//
// Cada flag suporta rollout PERCENTUAL para viabilizar CANARY: a decisao e'
// deterministica por um hash da `chave` do contexto, garantindo STICKINESS
// (o mesmo usuario cai sempre no mesmo braco) -- essencial para canary e para
// o experimento A/B do Modulo 4.

/**
 * Configuracao de uma unica flag.
 *
 * - `enabled`: liga/desliga globalmente. Se `false`, a flag esta OFF para todos.
 * - `rolloutPercent` (0..100): quando presente e `enabled` e' `true`, apenas a
 *   fracao correspondente das chaves recebe o comportamento novo. Ausente (ou
 *   `enabled: false`) equivale a 0% ou 100% conforme `enabled`.
 */
export type FlagConfig = {
  enabled: boolean;
  rolloutPercent?: number;
};

/**
 * Contexto opcional de avaliacao. A `chave` (ex.: id de sessao, email do
 * cliente ou id do pedido) torna a decisao de rollout deterministica e sticky.
 */
export type FlagContexto = {
  chave?: string;
};

// Defaults no codigo: representam o comportamento vigente em PRODUCAO.
// `checkoutResiliente` nasce DESLIGADA -- o canary vai liga-la gradualmente.
const DEFAULTS: Record<string, FlagConfig> = {
  checkoutResiliente: { enabled: false },
};

// Cache da configuracao efetiva (defaults + overrides do ambiente).
let configCache: Record<string, FlagConfig> | null = null;

/**
 * Le e valida os overrides vindos da variavel de ambiente `FLAGS` (JSON).
 * Exemplo: FLAGS='{"checkoutResiliente":{"enabled":true,"rolloutPercent":25}}'
 * JSON invalido e' ignorado (fail-safe: mantem os defaults).
 */
function lerOverridesDoAmbiente(): Record<string, FlagConfig> {
  const bruto = process.env.FLAGS;
  if (bruto === undefined || bruto.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(bruto) as Record<string, FlagConfig>;
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    // Nunca deixamos config malformada derrubar o servico.
    return {};
  }
}

/**
 * Monta (e memoiza) a configuracao efetiva: defaults sobrescritos pelo ambiente.
 */
function obterConfig(): Record<string, FlagConfig> {
  if (configCache === null) {
    configCache = { ...DEFAULTS, ...lerOverridesDoAmbiente() };
  }
  return configCache;
}

/**
 * Limpa o cache de flags. Util em testes que mexem em `process.env.FLAGS`.
 */
export function recarregarFlags(): void {
  configCache = null;
}

/**
 * Hash deterministico de string (FNV-1a 32 bits). Mesma entrada -> mesmo numero,
 * distribuicao razoavelmente uniforme -- suficiente para bucketizar rollout.
 */
function hashString(valor: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < valor.length; i += 1) {
    hash ^= valor.charCodeAt(i);
    // multiplicacao pelo primo FNV, mantida em 32 bits sem sinal.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Bucket 0..99 estavel para uma chave (dentro do namespace de uma flag).
function bucketDaChave(flag: string, chave: string): number {
  return hashString(`${flag}:${chave}`) % 100;
}

/**
 * Decide se uma flag esta ligada para o contexto dado.
 *
 * Regras:
 *  - flag desconhecida -> `false` (fail-closed).
 *  - `enabled: false` -> `false`.
 *  - `enabled: true` sem `rolloutPercent` -> `true` (100%).
 *  - `enabled: true` com `rolloutPercent`:
 *      - `<= 0`  -> `false`;
 *      - `>= 100`-> `true`;
 *      - caso contrario, precisa de `contexto.chave`: `bucket < rolloutPercent`.
 *        Sem chave num rollout parcial, retorna `false` (conservador: nao
 *        expoe o comportamento novo sem poder garantir stickiness).
 *
 * @param flag nome da flag (ex.: 'checkoutResiliente').
 * @param contexto contexto opcional; use `chave` para rollout sticky.
 */
export function isEnabled(flag: string, contexto: FlagContexto = {}): boolean {
  const config = obterConfig()[flag];
  if (config === undefined || !config.enabled) {
    return false;
  }

  const { rolloutPercent } = config;
  if (rolloutPercent === undefined) {
    return true;
  }
  if (rolloutPercent <= 0) {
    return false;
  }
  if (rolloutPercent >= 100) {
    return true;
  }

  const chave = contexto.chave;
  if (chave === undefined || chave === '') {
    return false;
  }
  return bucketDaChave(flag, chave) < rolloutPercent;
}
