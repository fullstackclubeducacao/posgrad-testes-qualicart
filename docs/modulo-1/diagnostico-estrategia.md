# Diagnóstico de Estratégia de Testes — QualiCart (Módulo 1)

## 1. Pirâmide vs. Troféu: qual serve ao QualiCart?

A escolha da forma da suíte não é estética: ela responde à pergunta **"onde está o risco e qual é o teste mais barato que o reduz?"**, sempre sob um orçamento de testes finito.

No QualiCart, o valor e o risco estão concentrados na **lógica de negócio pura**: o cálculo de subtotal (`calcularSubtotal` em `cart.ts`), as regras de cupom (`aplicarCupom`/`descontar` em `coupon.ts`) e as regras de frete (`calcularFrete` em `shipping.ts`). São funções determinísticas, sem I/O, cheias de ramificações e limiares — por exemplo, o `LIMIAR_FRETE_GRATIS = 200` e as faixas por primeiro dígito do CEP (`<= 3`, `<= 6`, senão) em `shipping.ts`, ou a regra do mínimo de carrinho e o piso de zero (`total < 0 ? 0 : total`) em `coupon.ts`. Esse é exatamente o perfil de um **"motor de precificação/regras"**: muitas combinações de entrada, cada uma com um resultado exato esperado. O teste mais barato e mais preciso para esse risco é o **teste de unidade**. Um bug de R$ a mais ou a menos no total é caro e frequente; cobri-lo exige uma **base larga de testes unitários** — ou seja, uma **pirâmide**.

O **troféu** (base menor de unidade, centro de gravidade em testes de integração) seria preferível quando o valor do sistema está na **orquestração e na integração**: um BFF que costura chamadas a APIs, um controlador que traduz HTTP em persistência, código onde a lógica própria é rasa e o risco real mora nas fronteiras. Não é o caso aqui: no QualiCart a orquestração (`processarCheckout`) é fina em valor, mas as regras que ela chama são ricas. Logo, investir o orçamento na base unitária domina.

## 2. Três code smells no orquestrador `processarCheckout` (`checkout.ts`)

O orquestrador é a principal fonte de problemas — e serve para ilustrar que **o teste é um detector de design ruim**: código difícil de testar quase sempre é código mal desenhado (testabilidade é propriedade de design).

- **Lista de parâmetros longa (Long Parameter List).** `processarCheckout` recebe **7 parâmetros** posicionais (`itens`, `cupom`, `cep`, `nomeCliente`, `emailCliente`, `freteGratisVip`, `observacao` — linhas 23–31). Três deles (`nomeCliente`, `emailCliente`, `observacao`) sequer participam do cálculo: são descartados com `void` (linhas 81–83). Cada teste precisa montar um chamado com strings irrelevantes (veja `'Ana'`, `'ana@example.com'`, `''` nos testes), o que é ruído e convite a erro por ordem de argumentos.

- **Aninhamento excessivo de condicionais (Arrow Anti-pattern).** Entre as linhas 39 e 78 há até **quatro níveis** de `if` aninhados: `itens.length > 0` → `cupom !== null` → `cupom.tipo === 'percentual'` → `freteGratisVip`. A explosão de caminhos torna difícil enxergar qual combinação leva a qual resultado e força muitos casos de teste apenas para exercitar a estrutura.

- **Código duplicado (Duplicated Code).** Os ramos `percentual` (linhas 41–50) e o `else` de cupom (linhas 51–60) são **idênticos linha a linha**. E o bloco "calcula frete ou zera se VIP" se repete **três vezes** (linhas 44–50, 54–60 e 65–71). Duplicação assim significa que uma correção de regra precisa ser feita em três lugares, e é o principal indício de que a lógica deveria ser extraída.

## 3. A dívida técnica mais cara

A dívida de maior "juro" é o **orquestrador acoplado e duplicado**. Ele mistura, num único ponto, decisão de cupom, decisão de frete e montagem do resultado, com ramos repetidos. O custo recorrente aparece de duas formas: (a) **testar as regras isoladamente fica caro** — para verificar uma faixa de frete sou obrigado a passar por `processarCheckout` inteiro, com cupom e cliente fictícios; (b) **cada mudança de regra tem alto risco de regressão**, porque precisa ser replicada nos blocos duplicados. É dívida que cobra juro a cada teste escrito e a cada alteração futura.

**Pagamento recomendado:** manter as regras já extraídas (`cart`, `coupon`, `shipping`) como o núcleo testável em unidade, cobri-las com uma base larga de casos (limiares, mínimos, piso zero, faixas de CEP) e reduzir `processarCheckout` a uma composição fina e sem duplicação dessas funções — eliminando os ramos idênticos e os parâmetros mortos. É exatamente o movimento que o Módulo 1 começa a fazer: transformar testabilidade em propriedade de design e gastar o orçamento de testes onde o risco realmente está.
