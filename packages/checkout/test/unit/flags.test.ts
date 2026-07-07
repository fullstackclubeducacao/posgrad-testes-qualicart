import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isEnabled, recarregarFlags } from '../../src/flags.ts';

// Define FLAGS no ambiente e limpa o cache do modulo antes de avaliar.
function comFlags(config: unknown): void {
  process.env.FLAGS = JSON.stringify(config);
  recarregarFlags();
}

describe('flags.isEnabled', () => {
  const flagsOriginal = process.env.FLAGS;

  beforeEach(() => {
    delete process.env.FLAGS;
    recarregarFlags();
  });

  afterEach(() => {
    if (flagsOriginal === undefined) {
      delete process.env.FLAGS;
    } else {
      process.env.FLAGS = flagsOriginal;
    }
    recarregarFlags();
  });

  it('default de checkoutResiliente e DESLIGADA (comportamento em producao)', () => {
    assert.equal(isEnabled('checkoutResiliente'), false);
  });

  it('flag desconhecida retorna false (fail-closed)', () => {
    assert.equal(isEnabled('naoExiste'), false);
  });

  it('enabled:true sem rolloutPercent liga para todos (100%)', () => {
    comFlags({ checkoutResiliente: { enabled: true } });
    assert.equal(isEnabled('checkoutResiliente'), true);
    assert.equal(isEnabled('checkoutResiliente', { chave: 'qualquer' }), true);
  });

  it('enabled:false mantem desligado mesmo com rolloutPercent', () => {
    comFlags({ checkoutResiliente: { enabled: false, rolloutPercent: 100 } });
    assert.equal(isEnabled('checkoutResiliente', { chave: 'x' }), false);
  });

  it('rollout 0% desliga para todas as chaves', () => {
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 0 } });
    for (const chave of ['a', 'b', 'c', 'sessao-123', 'user@x.com']) {
      assert.equal(isEnabled('checkoutResiliente', { chave }), false);
    }
  });

  it('rollout 100% liga para todas as chaves', () => {
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 100 } });
    for (const chave of ['a', 'b', 'c', 'sessao-123', 'user@x.com']) {
      assert.equal(isEnabled('checkoutResiliente', { chave }), true);
    }
  });

  it('rollout parcial sem chave e conservador (false)', () => {
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 50 } });
    assert.equal(isEnabled('checkoutResiliente'), false);
    assert.equal(isEnabled('checkoutResiliente', { chave: '' }), false);
  });

  it('stickiness: a mesma chave sempre cai no mesmo braco', () => {
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 37 } });
    const chave = 'pedido-abc-42';
    const primeira = isEnabled('checkoutResiliente', { chave });
    for (let i = 0; i < 100; i += 1) {
      assert.equal(isEnabled('checkoutResiliente', { chave }), primeira);
    }
  });

  it('distribuicao aproxima o rolloutPercent sobre muitas chaves', () => {
    const alvo = 30;
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: alvo } });

    const total = 10000;
    let ligados = 0;
    for (let i = 0; i < total; i += 1) {
      if (isEnabled('checkoutResiliente', { chave: `sessao-${i}` })) {
        ligados += 1;
      }
    }
    const percentualObservado = (ligados / total) * 100;
    // Tolerancia de +/- 3 pontos percentuais para o hash uniforme.
    assert.ok(
      Math.abs(percentualObservado - alvo) < 3,
      `esperado ~${alvo}%, observado ${percentualObservado.toFixed(1)}%`,
    );
  });

  it('rollouts sao independentes: 25% e um subconjunto de 50% (monotonico) nao e garantido, mas a mesma chave e estavel entre chamadas', () => {
    const chave = 'cliente-estavel';
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 50 } });
    const a = isEnabled('checkoutResiliente', { chave });
    comFlags({ checkoutResiliente: { enabled: true, rolloutPercent: 50 } });
    const b = isEnabled('checkoutResiliente', { chave });
    assert.equal(a, b);
  });

  it('FLAGS com JSON invalido cai nos defaults (fail-safe)', () => {
    process.env.FLAGS = '{isso nao e json';
    recarregarFlags();
    assert.equal(isEnabled('checkoutResiliente'), false);
  });
});
