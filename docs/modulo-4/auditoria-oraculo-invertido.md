# Auditoria de Oráculo Invertido — Geração de testes assistida por IA

> Módulo 4 — QualiCart · pacote `checkout` · função `processarCheckout`

## 1. O que é o "oráculo invertido"

Em teste de software, o **oráculo** é a fonte de verdade que decide se um
resultado observado está **certo ou errado**. Normalmente é o ser humano (ou
uma especificação) quem cumpre esse papel.

Quando pedimos a um LLM que **gere testes**, acontece uma inversão sutil e
perigosa:

- A IA não conhece a *intenção* do negócio. Para inventar o valor esperado de
  uma asserção, ela **executa (ou deduz) o código atual** e escreve
  `assert.equal(resultado, <o que o código produziu>)`.
- Ou seja, a IA infere a asserção **do que o código FAZ**, não **do que
  DEVERIA fazer**.
- Se existe um **bug latente**, a IA o transforma em "comportamento esperado".
  O teste nasce **verde** e passa a **blindar o bug**: qualquer correção
  futura quebra o teste, e o desenvolvedor é induzido a "consertar o teste" de
  volta para o valor errado.

Isso é o **oráculo invertido**: o teste, em vez de proteger contra o defeito,
o cristaliza. O papel do humano deixa de ser escrever o teste e passa a ser
**auditar o oráculo** — confirmar, asserção por asserção, se o valor esperado
corresponde ao comportamento **desejado**, não ao comportamento **observado**.

## 2. O caso real encontrado no QualiCart

A função `processarCheckout` (e as auxiliares `calcularSubtotal`,
`aplicarCupom`, `calcularFrete`) fazia toda a aritmética monetária em `number`
(ponto flutuante IEEE-754) **sem arredondar a centavos**.

Reproduzindo um checkout de 2 camisetas a R$ 59,90 com cupom de 10%:

```
subtotal  = 59.90 * 2            = 119.8
desconto  = 119.8 * 0.10         = 11.980000000000004   <-- lixo de float
total     = (119.8 - desconto) + frete(15) = 122.82
```

O campo `desconto` carregava o erro de ponto flutuante
`11.980000000000004` — dinheiro nunca deveria ter mais de 2 casas decimais.

### A asserção que a IA geraria (oráculo invertido)

Ao gerar a suíte, o LLM executaria esse caso e escreveria **exatamente**:

```ts
// [ORACULO-INVERTIDO] rascunho gerado pela IA
assert.equal(resultado.desconto, 11.980000000000004);
```

Por que essa asserção é traiçoeira:

1. **Passa no código bugado.** Ela reflete fielmente o que a função retorna,
   então a suíte fica verde e transmite falsa confiança.
2. **Blinda o bug.** No dia em que alguém corrigir o arredondamento (fazendo o
   desconto virar `11.98`), este teste **falha**. A leitura natural do
   desenvolvedor apressado é "o teste quebrou, ajusta o esperado" — revertendo
   a asserção para o valor errado e desfazendo a correção.
3. **Documenta o defeito como requisito.** Quem lê o teste passa a acreditar
   que `11.980000000000004` é o comportamento correto e intencional.

## 3. A correção (raiz + asserção auditada)

### 3.1 Corrigir a raiz em `checkout.ts`

Adicionamos um helper de arredondamento e o aplicamos a **todos** os campos
monetários do `ResultadoCheckout`:

```ts
export function arredondarMoeda(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// ...
return {
  subtotal: arredondarMoeda(subtotal),
  desconto: arredondarMoeda(desconto),
  frete:    arredondarMoeda(frete),
  total:    arredondarMoeda(total),
};
```

Nenhuma regra de negócio foi alterada — apenas o **contrato de dinheiro em
centavos** foi tornado explícito na fronteira de saída.

### 3.2 Corrigir a asserção (o humano é o oráculo)

Depois de auditar, substituímos o rascunho invertido pelo valor **desejado**:

```ts
// [ORACULO-INVERTIDO] (antes — NÃO usar):
//   assert.equal(resultado.desconto, 11.980000000000004);

// [AUDITADO] (depois — comportamento desejado):
assert.equal(resultado.desconto, 11.98);
assert.equal(Number(resultado.desconto.toFixed(2)), resultado.desconto); // sem lixo de float
```

Antes × depois (mesmo caso de entrada):

| Campo    | Antes (bugado)         | Depois (corrigido) |
|----------|------------------------|--------------------|
| desconto | `11.980000000000004`   | `11.98`            |
| total    | `122.82`               | `122.82`           |

Também adicionamos uma asserção de **invariante** que percorre todos os campos
monetários e garante que `arredondarMoeda(v) === v` — uma rede de segurança
que não depende de um valor mágico específico.

Os testes de unidade já existentes em `checkout.test.ts` usavam valores já
"redondos" (`159.7`, `0`) ou asserções tolerantes (`assert.ok`), portanto
**nenhuma asserção de outro teste precisou ser ajustada**.

## 4. Regra de ouro

> **Nunca aceite uma asserção gerada por IA sem confirmar o comportamento
> DESEJADO.** O valor esperado de um teste deve vir da especificação/intenção
> do negócio — nunca de "o que o código imprimiu". Se a IA gera o rascunho, o
> humano continua sendo o oráculo.

Heurísticas práticas de auditoria:

- **Desconfie de constantes esquisitas.** Números como
  `11.980000000000004`, `0.30000000000000004` ou datas/IDs "mágicos" são
  sinal de asserção copiada da saída — pare e valide.
- **Pergunte "qual é o valor certo?" antes de rodar o teste.** Calcule o
  esperado de forma independente (regra de negócio), depois compare.
- **Prefira invariantes a valores literais** quando fizer sentido (ex.: "tem 2
  casas decimais", "total = subtotal − desconto + frete", "nunca negativo").
- **Teste vermelho primeiro.** Um teste que nunca falhou pode estar apenas
  espelhando o bug; confirme que ele reprova o comportamento errado.
