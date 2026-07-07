// ---------------------------------------------------------------------------
// Suite "gerada por IA" para processarCheckout + auditoria de oraculo invertido
// ---------------------------------------------------------------------------
//
// Este arquivo simula um fluxo real de "geracao de testes assistida por IA".
// Um LLM, ao gerar asseroes, tende a inferir o valor esperado do que o codigo
// FAZ (executando/deduzindo) e NAO do que o codigo DEVERIA fazer. Quando ha um
// bug latente, ele cristaliza o bug como "esperado" -> oraculo invertido.
//
// Convenoes:
//   [RASCUNHO-IA]   -> asseroes exatamente como um LLM as geraria.
//   [ORACULO-INVERTIDO] -> asserao que cristalizava comportamento ERRADO.
//   [AUDITADO]      -> asserao ja revisada pelo humano (o verdadeiro oraculo).
//
// Bug de dominio auditado aqui: valores monetarios nao eram arredondados a
// centavos. 2x59,90 com cupom de 10% produzia desconto = 11.980000000000004
// (erro de ponto flutuante). Corrigido em checkout.ts via arredondarMoeda().

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processarCheckout, arredondarMoeda } from '../../src/checkout.ts';
import type { ItemCarrinho } from '../../src/cart.ts';

const ITENS: ItemCarrinho[] = [
  { sku: 'CAM-001', nome: 'Camiseta', precoUnitario: 59.9, quantidade: 2 },
  { sku: 'CAN-001', nome: 'Caneca', precoUnitario: 39.9, quantidade: 1 },
];

describe('processarCheckout (suite gerada por IA + auditada)', () => {
  // [RASCUNHO-IA] Caso feliz simples: sem cupom, sem VIP.
  it('calcula subtotal e frete sem cupom', () => {
    const r = processarCheckout(
      ITENS,
      null,
      '01000-000',
      'Ana',
      'ana@example.com',
      false,
      '',
    );

    assert.equal(r.subtotal, 159.7);
    assert.equal(r.desconto, 0);
    assert.equal(r.frete, 15);
    assert.equal(r.total, 174.7);
  });

  // -------------------------------------------------------------------------
  // ORACULO INVERTIDO (o caso central desta atividade)
  // -------------------------------------------------------------------------
  // [RASCUNHO-IA] A IA gerou este caso com um unico item (2x59,90) + cupom 10%.
  // Ela EXECUTOU mentalmente o codigo bugado e cristalizou o float exato:
  //
  //   [ORACULO-INVERTIDO]  assert.equal(r.desconto, 11.980000000000004);
  //
  // Essa asserao PASSARIA no codigo original e BLINDARIA o bug: qualquer
  // correao de arredondamento futura quebraria o teste, e o desenvolvedor
  // seria induzido a "consertar o teste" de volta para o valor errado.
  //
  // [AUDITADO] O humano (oraculo real) determina o comportamento DESEJADO:
  // dinheiro tem 2 casas -> desconto = 11.98. Apos corrigir a raiz em
  // checkout.ts, a asserao correta e:
  it('[oraculo invertido -> auditado] aplica cupom percentual com dinheiro em centavos', () => {
    const umItem: ItemCarrinho[] = [
      { sku: 'CAM-001', nome: 'Camiseta', precoUnitario: 59.9, quantidade: 2 },
    ];

    const r = processarCheckout(
      umItem,
      { tipo: 'percentual', valor: 10 },
      '01000-000',
      'Bruno',
      'bruno@example.com',
      false,
      '',
    );

    assert.equal(r.subtotal, 119.8);

    // [ORACULO-INVERTIDO] (rascunho original da IA — NAO usar):
    //   assert.equal(r.desconto, 11.980000000000004);
    // [AUDITADO] valor correto arredondado a centavos:
    assert.equal(r.desconto, 11.98);

    // Blindagem extra: garante 2 casas decimais reais (sem lixo de float).
    assert.equal(Number(r.desconto.toFixed(2)), r.desconto);
    assert.equal(r.total, 122.82);
  });

  // [RASCUNHO-IA] Cupom fixo aplicado.
  it('aplica cupom fixo', () => {
    const r = processarCheckout(
      ITENS,
      { tipo: 'fixo', valor: 20 },
      '01000-000',
      'Carla',
      'carla@example.com',
      false,
      '',
    );

    assert.equal(r.subtotal, 159.7);
    assert.equal(r.desconto, 20);
    assert.equal(r.frete, 15);
    assert.equal(r.total, 154.7);
  });

  // [RASCUNHO-IA] Cliente VIP: frete gratis.
  it('cliente VIP nao paga frete', () => {
    const r = processarCheckout(
      ITENS,
      null,
      '20000-000',
      'Diana',
      'diana@example.com',
      true,
      'entregar pela manha',
    );

    assert.equal(r.frete, 0);
    assert.equal(r.total, r.subtotal);
  });

  // [RASCUNHO-IA] Borda: carrinho vazio zera tudo.
  it('carrinho vazio devolve tudo zerado', () => {
    const r = processarCheckout(
      [],
      { tipo: 'percentual', valor: 50 },
      '01000-000',
      'Eva',
      'eva@example.com',
      false,
      '',
    );

    assert.deepEqual(r, { subtotal: 0, desconto: 0, frete: 0, total: 0 });
  });

  // [RASCUNHO-IA] Borda: subtotal >= 200 -> frete gratis por limiar.
  it('frete gratis acima do limiar de R$200', () => {
    const caros: ItemCarrinho[] = [
      { sku: 'TEN-001', nome: 'Tenis', precoUnitario: 250, quantidade: 1 },
    ];

    const r = processarCheckout(
      caros,
      null,
      '01000-000',
      'Felipe',
      'felipe@example.com',
      false,
      '',
    );

    assert.equal(r.frete, 0);
    assert.equal(r.total, 250);
  });

  // [AUDITADO] Invariante de dinheiro: nenhum campo carrega lixo de float.
  it('todos os campos monetarios tem no maximo 2 casas decimais', () => {
    const r = processarCheckout(
      ITENS,
      { tipo: 'percentual', valor: 33 },
      '70000-000',
      'Gabi',
      'gabi@example.com',
      false,
      '',
    );

    for (const campo of ['subtotal', 'desconto', 'frete', 'total'] as const) {
      const v = r[campo];
      assert.equal(arredondarMoeda(v), v, `${campo} deveria estar em centavos`);
    }
  });
});
