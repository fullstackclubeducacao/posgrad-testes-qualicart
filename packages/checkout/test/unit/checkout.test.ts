import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processarCheckout } from '../../src/checkout.ts';
import type { ItemCarrinho } from '../../src/cart.ts';

const ITENS: ItemCarrinho[] = [
  { sku: 'CAM-001', nome: 'Camiseta', precoUnitario: 59.9, quantidade: 2 },
  { sku: 'CAN-001', nome: 'Caneca', precoUnitario: 39.9, quantidade: 1 },
];

describe('processarCheckout', () => {
  it('calcula o subtotal do carrinho sem cupom', () => {
    const resultado = processarCheckout(
      ITENS,
      null,
      '01000-000',
      'Ana',
      'ana@example.com',
      false,
      '',
    );

    assert.equal(resultado.subtotal, 159.7);
    assert.equal(resultado.desconto, 0);
  });

  it('aplica um cupom percentual sem minimo de carrinho', () => {
    const resultado = processarCheckout(
      ITENS,
      { tipo: 'percentual', valor: 10 },
      '01000-000',
      'Bruno',
      'bruno@example.com',
      false,
      '',
    );

    assert.ok(resultado.desconto > 0);
    assert.ok(resultado.total < resultado.subtotal + resultado.frete);
  });

  // Smoke: apenas exercita o fluxo de checkout com cliente VIP.
  it('processa um checkout de cliente VIP', () => {
    processarCheckout(
      ITENS,
      null,
      '20000-000',
      'Carla',
      'carla@example.com',
      true,
      'entregar pela manha',
    );
  });
});
