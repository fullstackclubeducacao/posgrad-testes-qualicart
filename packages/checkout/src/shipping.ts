// Regras de calculo de frete.

const LIMIAR_FRETE_GRATIS = 200;

/**
 * Calcula o frete com base no subtotal e no CEP de destino.
 *
 * - Acima do limiar de frete gratis (R$200), o frete e zero.
 * - Caso contrario, o valor base varia por regiao, usando o primeiro
 *   digito do CEP como aproximacao grosseira de distancia.
 */
export function calcularFrete(subtotal: number, cep: string): number {
  if (subtotal >= LIMIAR_FRETE_GRATIS) {
    return 0;
  }

  const primeiroDigito = Number(cep.trim().charAt(0));

  if (Number.isNaN(primeiroDigito)) {
    return 25;
  }

  // Regioes "proximas" (CEPs iniciados em 0-3) pagam menos.
  if (primeiroDigito <= 3) {
    return 15;
  }

  if (primeiroDigito <= 6) {
    return 20;
  }

  return 30;
}
