// Tratamento ESTATISTICO do nao-determinismo.
//
// A virada mental deste modulo: com um LLM a pergunta deixa de ser binaria
// ("a resposta esta certa?") e passa a ser DISTRIBUCIONAL ("com que frequencia
// a resposta e boa o suficiente?"). Confiabilidade vira uma PROPRIEDADE da
// DISTRIBUICAO, nao de uma unica execucao.
//
// Estrategia: rodamos o MESMO caso N vezes e assertamos sobre a distribuicao
// (>= X% de execucoes boas), nunca sobre uma execucao isolada. Reportamos a
// distribuicao real e categorizamos as saidas "menos boas" (levemente abaixo
// do ideal vs catastrofico).
//
// Simulacao OFFLINE vs modelo REAL:
//  - Aqui o nao-determinismo e SIMULADO pelo FakeLlmClient com `variacao` (seed
//    por indice): mesma seed -> mesma saida, entao o AGREGADO e deterministico
//    e o teste NAO fica flaky. A variacao do fake e cosmetica (tom/sufixo) e
//    NUNCA altera a correcao numerica -> a correcao e invariante (100%).
//  - Com o modelo REAL rodariamos de fato as N chamadas (tolerando custo e
//    latencia): ali a variacao seria genuina (conteudo, formato, tom) e a
//    barra >= X% faria trabalho real, pegando os casos em que o modelo erra.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssistenteCheckout } from '../../src/agent.ts';
import { FakeLlmClient } from '../../src/llm-client.ts';
import { criarFerramentasPadrao } from '../../src/tools.ts';
import type { Ferramentas } from '../../src/tools.ts';
import {
  MENSAGEM_FALLBACK,
  MENSAGEM_RECUSA,
  saidaInsegura,
} from '../../src/guardrails.ts';

// Numero de execucoes do mesmo caso. Com o modelo real seria o "N de fato";
// aqui e o numero de seeds simuladas.
const N = 50;

// Barra de confiabilidade DISTRIBUCIONAL: o caso deve passar em >= 95% das
// execucoes. E uma assercao estatistica, NAO binaria.
const BARRA_BOA = 0.95;

// Ferramentas mockadas para um total redondo e estavel, independente do
// catalogo real: camiseta a R$50 -> 2 x 50 = 100, -10% = 90, + frete 15 = 105.
function ferramentasDeteste(): Ferramentas {
  return criarFerramentasPadrao({
    buscarProduto: (sku: string) =>
      sku === 'CAM-001' ? { sku, nome: 'Camiseta', preco: 50 } : undefined,
  });
}

const CASO = 'quanto fica meu carrinho com 2 camisetas e o cupom DESCONTO10?';
const TOTAL_ESPERADO = /R\$105\.00/;
const EMOJI = /\p{Extended_Pictographic}/u;

type Veredito = 'ideal' | 'cordial' | 'informal' | 'incorreta' | 'catastrofica';

/**
 * Verificador simples de qualidade (o "oraculo" fraco que se usa quando nao ha
 * resposta unica canonica). Classifica UMA saida:
 *  - catastrofica: vazia / fallback / conteudo inseguro (falha dura);
 *  - incorreta   : nao contem o total correto (erro de conteudo);
 *  - informal    : correta, porem com emoji (tom menos profissional);
 *  - cordial     : correta, sem emoji, com fecho cordial extra;
 *  - ideal       : correta, enxuta, sem ruido.
 * "boa" = qualquer uma das tres ultimas (correta e segura).
 */
function classificar(resposta: string, recusado: boolean | undefined): Veredito {
  const vazia = resposta.trim() === '';
  if (vazia || resposta === MENSAGEM_FALLBACK || saidaInsegura(resposta)) {
    return 'catastrofica';
  }
  if (recusado === true || !TOTAL_ESPERADO.test(resposta)) {
    return 'incorreta';
  }
  if (EMOJI.test(resposta)) {
    return 'informal';
  }
  // Fecho cordial extra deixa a resposta mais longa que o nucleo factual.
  const cordial = /Até logo|Precisa de mais algo/.test(resposta);
  return cordial ? 'cordial' : 'ideal';
}

const EH_BOA: ReadonlySet<Veredito> = new Set(['ideal', 'cordial', 'informal']);

describe('Nao-determinismo: distribuicao sobre N execucoes do mesmo caso', () => {
  it(`o caso "total do carrinho" e bom em >= ${BARRA_BOA * 100}% de ${N} execucoes`, async () => {
    const contagem: Record<Veredito, number> = {
      ideal: 0,
      cordial: 0,
      informal: 0,
      incorreta: 0,
      catastrofica: 0,
    };
    const amostrasRuins: string[] = [];

    for (let i = 0; i < N; i++) {
      // Seed POR INDICE: simula uma amostra independente do LLM. Deterministico
      // no agregado (mesma seed -> mesma saida) => teste estavel, nao flaky.
      const assistente = new AssistenteCheckout(new FakeLlmClient({ variacao: i }), {
        ferramentas: ferramentasDeteste(),
      });
      const r = await assistente.responder(CASO);
      const v = classificar(r.resposta, r.recusado);
      contagem[v] += 1;
      if (!EH_BOA.has(v)) {
        amostrasRuins.push(`[${v}] ${r.resposta}`);
      }
    }

    const boas = contagem.ideal + contagem.cordial + contagem.informal;
    const taxaBoa = boas / N;
    const taxaCatastrofica = contagem.catastrofica / N;

    // Relatorio da distribuicao REAL medida (o "quanto bom" e o "quao ruim").
    console.log('\n=== Distribuicao de qualidade (N=%d, caso "total do carrinho") ===', N);
    console.log('  boas .............. %d/%d (%s%%)', boas, N, (taxaBoa * 100).toFixed(1));
    console.log('  - ideal (enxuta) .. %d', contagem.ideal);
    console.log('  - cordial (+fecho)  %d', contagem.cordial);
    console.log('  - informal (emoji)  %d  <- levemente abaixo do ideal (tom)', contagem.informal);
    console.log('  incorretas ........ %d  <- erro de conteudo', contagem.incorreta);
    console.log('  catastroficas ..... %d  <- vazia/fallback/insegura', contagem.catastrofica);
    if (amostrasRuins.length > 0) {
      console.log('  exemplos nao-bons:');
      for (const a of amostrasRuins.slice(0, 3)) console.log('    ' + a);
    }
    console.log('  correcao numerica invariante nesta simulacao (fake so varia o tom).');

    // Assercao ESTATISTICA (nao binaria): o caso passa na maioria esmagadora.
    assert.ok(
      taxaBoa >= BARRA_BOA,
      `taxaBoa=${(taxaBoa * 100).toFixed(1)}% abaixo da barra de ${BARRA_BOA * 100}%`,
    );
    // E, alem da barra, garantimos ZERO falhas duras (nada catastrofico).
    assert.equal(taxaCatastrofica, 0, 'houve saida catastrofica (vazia/insegura/fallback)');
  });

  it('mesma seed -> mesma saida: o agregado e reprodutivel (nao flaky)', async () => {
    const rodar = async () => {
      const linhas: string[] = [];
      for (let i = 0; i < N; i++) {
        const assistente = new AssistenteCheckout(new FakeLlmClient({ variacao: i }), {
          ferramentas: ferramentasDeteste(),
        });
        linhas.push((await assistente.responder(CASO)).resposta);
      }
      return linhas.join('\n');
    };
    // Duas passagens independentes produzem exatamente a mesma distribuicao.
    assert.equal(await rodar(), await rodar());
  });

  it('categorizacao "quao ruim": nenhuma saida vaza a mensagem de recusa/fallback como conteudo bom', async () => {
    // Sanidade: MENSAGEM_RECUSA/FALLBACK nunca sao classificadas como boas.
    assert.equal(classificar(MENSAGEM_FALLBACK, false), 'catastrofica');
    assert.equal(classificar(MENSAGEM_RECUSA, true), 'incorreta');
  });
});
