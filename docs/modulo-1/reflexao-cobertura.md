# Reflexão sobre Cobertura Significativa — QualiCart (Módulo 1)

## 1. A armadilha: cobertura mede execução, não verificação

Métricas de cobertura (linhas, ramos, funções) respondem a uma única pergunta: **"esta linha foi executada durante os testes?"**. Elas não dizem nada sobre a pergunta que realmente importa — **"o resultado foi verificado?"**. Um teste que roda o código e não olha para o que saiu produz cobertura "de graça": a métrica sobe, mas a rede de segurança não existe. Cobertura alta com asserções fracas é uma falsa sensação de proteção.

## 2. Caso real do projeto: um teste que cobre sem verificar

O próprio starter tem o exemplo perfeito em `packages/checkout/test/checkout.test.ts`:

```ts
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
```

Esse teste **chama `processarCheckout` mas não tem nenhuma asserção** — nenhum `assert`. Ainda assim, ele **executa** vários trechos do orquestrador em `packages/checkout/src/checkout.ts`:

- entra no ramo `itens.length > 0` (linha 39), pois `ITENS` tem produtos;
- como `cupom` é `null`, percorre o `else` de "sem cupom" (linhas 62–72);
- como `freteGratisVip` é `true`, executa o ramo VIP `frete = 0` (linhas 65–67);
- passa pelos descartes `void nomeCliente/emailCliente/observacao` (linhas 81–83) e pelo `return` (linhas 85–90).

Além disso, `calcularSubtotal` (`cart.ts`) roda por completo. Ou seja, esse único teste **"cobre" um caminho inteiro do orquestrador e sobe a métrica de cobertura de linhas e de ramos** — sem verificar coisa alguma.

O ponto decisivo: **este teste passaria mesmo que a função retornasse valores errados**. Se `processarCheckout` devolvesse `total: 9999`, ou `subtotal: 0`, ou trocasse desconto por frete, o teste continuaria verde, porque ninguém compara a saída com um valor esperado. Ele só falharia se a função lançasse uma exceção. É cobertura sem confiança: executa, mas não protege.

Para comparação, o teste vizinho `it('calcula o subtotal do carrinho sem cupom', ...)` cobre um caminho parecido, mas **verifica** (`assert.equal(resultado.subtotal, 159.7)` e `assert.equal(resultado.desconto, 0)`) — esse, sim, detectaria uma regressão no cálculo.

## 3. Princípio: cobertura é piso, não teto

Cobertura é um **piso, não um teto**. Serve para revelar o que nunca foi executado (código sem nenhum teste), não para atestar qualidade. Um alvo saudável fica em torno de **70–80%**, sempre acompanhado de **julgamento sobre o que está coberto**: as regras de risco (limiares de frete, mínimo de cupom, piso de desconto) merecem verificação forte; getters triviais, não. Perseguir 100% sem asserções significativas só multiplica testes como o do "cliente VIP".

Isso deixa uma pergunta em aberto que a cobertura não consegue responder: **"meus testes DETECTARIAM um bug se ele fosse introduzido?"**. Existe uma técnica feita exatamente para isso — o **mutation testing**, que injeta defeitos no código e mede se a suíte os pega. É o que separa "executar" de "verificar". Veremos isso adiante.
