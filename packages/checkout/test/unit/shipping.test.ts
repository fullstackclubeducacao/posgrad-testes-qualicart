import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calcularFrete } from '../../src/shipping.ts';

describe('calcularFrete', () => {
  it('cobra R$15 para regiao proxima (CEP iniciado em 0-3) abaixo do limiar', () => {
    assert.equal(calcularFrete(100, '01001000'), 15);
    assert.equal(calcularFrete(100, '30110001'), 15);
  });

  it('cobra R$20 para regiao intermediaria (CEP iniciado em 4-6) abaixo do limiar', () => {
    assert.equal(calcularFrete(100, '40010000'), 20);
    assert.equal(calcularFrete(100, '60000000'), 20);
  });

  it('cobra R$30 para regiao distante (CEP iniciado em 7-9) abaixo do limiar', () => {
    assert.equal(calcularFrete(100, '70000000'), 30);
    assert.equal(calcularFrete(100, '99000000'), 30);
  });

  it('cobra R$25 quando o CEP nao comeca com digito valido', () => {
    assert.equal(calcularFrete(100, 'ABCDEFGH'), 25);
  });

  it('ignora espacos em branco ao redor do CEP', () => {
    assert.equal(calcularFrete(100, '  01001000  '), 15);
  });

  it('zera o frete para subtotal claramente acima do limiar de frete gratis', () => {
    assert.equal(calcularFrete(500, '99000000'), 0);
    assert.equal(calcularFrete(300, '01001000'), 0);
  });

  it('ainda cobra frete para subtotal claramente abaixo do limiar', () => {
    assert.equal(calcularFrete(50, '01001000'), 15);
    assert.equal(calcularFrete(150, '70000000'), 30);
  });

  it('libera frete gratis no subtotal EXATAMENTE no limiar (R$200)', () => {
    // Fronteira: a regra e "frete gratis a partir de R$200" (>=), entao em
    // exatamente R$200 o frete deve ser zero, independentemente da regiao.
    assert.equal(calcularFrete(200, '01001000'), 0);
    assert.equal(calcularFrete(200, '99000000'), 0);
  });

  it('ainda cobra frete logo abaixo do limiar (R$199,99)', () => {
    // O outro lado da fronteira: um centavo abaixo NAO libera frete gratis.
    assert.equal(calcularFrete(199.99, '01001000'), 15);
  });
});
