// Demo de linha de comando do assistente de checkout.
//
//   node packages/ai-assistant/src/cli.ts "sua pergunta"
//
// Usa o AnthropicLlmClient quando ANTHROPIC_API_KEY existe; senao, cai no
// FakeLlmClient (deterministico, offline). Deixa claro qual cliente esta ativo.

import { AssistenteCheckout } from './agent.ts';
import { AnthropicLlmClient, FakeLlmClient } from './llm-client.ts';
import type { LlmClient } from './llm-client.ts';

async function main(): Promise<void> {
  const pergunta = process.argv.slice(2).join(' ').trim();
  if (pergunta === '') {
    console.error('Uso: node packages/ai-assistant/src/cli.ts "sua pergunta"');
    process.exitCode = 1;
    return;
  }

  const temChave = typeof process.env.ANTHROPIC_API_KEY === 'string'
    && process.env.ANTHROPIC_API_KEY !== '';
  const cliente: LlmClient = temChave ? new AnthropicLlmClient() : new FakeLlmClient();

  console.log(`[cliente LLM: ${temChave ? 'AnthropicLlmClient (real)' : 'FakeLlmClient (offline, sem chave)'}]`);
  console.log(`> ${pergunta}\n`);

  const assistente = new AssistenteCheckout(cliente);
  const { resposta, ferramentasUsadas, recusado } = await assistente.responder(pergunta);

  console.log(resposta);
  if (ferramentasUsadas.length > 0) {
    console.log(`\n(ferramentas usadas: ${ferramentasUsadas.join(', ')})`);
  }
  if (recusado === true) {
    console.log('(resposta recusada por guardrail)');
  }
}

await main();
