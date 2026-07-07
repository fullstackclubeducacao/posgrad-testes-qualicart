# Contract Testing com Pact (checkout ↔ catálogo)

## O problema: evolução independente que quebra o consumidor em silêncio

No QualiCart, o serviço de **checkout** consome o serviço de **catálogo** por HTTP:

```
checkout (CONSUMIDOR)  --GET /produtos/:sku-->  catálogo (PROVEDOR)
                       <-- { sku, nome, preco } --
```

O consumidor real é `packages/checkout/src/catalog-client.ts` (`buscarProduto`),
que espera exatamente `{ sku: string, nome: string, preco: number }` e lança
`ProdutoNaoEncontradoError` quando o catálogo responde `404`.

Esses dois serviços evoluem de forma **independente** (times, deploys e
repositórios possivelmente separados). Suponha que o time do catálogo decida
"melhorar" o nome do campo e renomear `preco` para `precoUnitario`. Do ponto de
vista do catálogo, os testes dele continuam verdes — o serviço responde 200 com
um JSON válido. Mas o checkout, que lê `produto.preco`, passa a receber
`undefined` silenciosamente. O bug só aparece **em produção**, no cálculo do
carrinho, e é difícil de rastrear porque nenhum teste unitário de nenhum dos dois
lados falhou.

Testes de integração ponta-a-ponta (subir os dois serviços juntos) até pegam
isso, mas são caros, lentos e frágeis, e exigem que ambas as versões estejam
disponíveis ao mesmo tempo. O **contract testing** resolve o problema de forma
mais barata e desacoplada.

## Consumer-driven contracts + Pact

A ideia do **consumer-driven contract** inverte o fluxo: **é o consumidor quem
declara o que precisa** do provedor. O checkout descreve, num "contrato" (o
*pact*), as interações de que depende: "para `GET /produtos/CAM-001` eu espero
`200` com um corpo que tenha `sku` (string), `nome` (string) e `preco`
(number)". O provedor, então, precisa **provar** que satisfaz esse contrato.

O [Pact](https://pact.io) implementa isso em duas etapas complementares:

1. **Lado do consumidor** (`packages/checkout/test/contract/catalog.consumer.test.ts`):
   o Pact sobe um *mock server* que responde conforme a expectativa declarada.
   Rodamos o **cliente HTTP real** (`buscarProduto`) contra esse mock. Se o
   cliente consegue consumir a resposta, o Pact grava um arquivo de contrato em
   `pacts/qualicart-checkout-qualicart-catalog.json`.

2. **Lado do provedor** (`packages/catalog/test/contract/catalog.provider.test.ts`):
   o `Verifier` do Pact lê o arquivo de contrato committed, sobe o **catálogo
   real** (num porto dedicado, `3021`) e *replaya* cada interação contra ele,
   comparando a resposta real com o que o contrato exige.

Se as duas etapas passam, temos a garantia de que **o provedor entrega a forma
que o consumidor consome**, sem precisar subir os dois serviços juntos num teste
integrado.

### Matchers de tipo: importa a forma, não o dado

Um ponto central do contrato é usar **matchers de tipo** em vez de valores
fixos. No teste do consumidor declaramos:

```ts
body: {
  sku: string('CAM-001'),   // "tem que ser uma string"
  nome: string('Camiseta'), // "tem que ser uma string"
  preco: number(59.9),      // "tem que ser um número"
}
```

O valor (`59.9`) é só um **exemplo** para o mock server. O que fica gravado no
contrato como regra é `match: type` / `match: number`. Assim, o provedor pode
retornar `preco: 59.9` hoje e `preco: 79.9` amanhã sem quebrar o contrato — o
que importa é a **forma** (existir o campo `preco` e ser um número), não o dado
específico. Fixar o valor exato tornaria o contrato frágil e acoplado a dados.

### Pact Broker e `can-i-deploy` (conceitual)

Num fluxo real, o arquivo de pact não fica só no repositório: o consumidor
publica cada versão do contrato num **Pact Broker** (um servidor central). O
provedor, ao rodar sua verificação no CI, busca do Broker todos os contratos dos
seus consumidores e publica de volta o **resultado** (verificou / falhou) por
versão.

Com esse histórico centralizado, o Broker responde à pergunta que realmente
importa antes de um deploy:

```
pact-broker can-i-deploy \
  --pacticipant qualicart-catalog --version <sha> \
  --to-environment production
```

O `can-i-deploy` só retorna sucesso se **existe verificação verde** entre a
versão que se quer implantar e as versões dos outros serviços já em produção.
Isso transforma o contrato numa **trava de deploy**: o catálogo não sobe para
produção se a versão dele quebrar algum consumidor que já está lá. Neste
exercício não usamos um Broker rodando — versionamos o pact direto em `pacts/` —
mas o `pactUrls` do Verifier apontando para o arquivo é exatamente o papel que o
Broker cumpriria em escala.

## Demonstração real da quebra

Para provar que o contrato **pega de verdade** a evolução incompatível,
alteramos temporariamente o provedor (`packages/catalog/src/server.ts`) para
renomear `preco` → `precoUnitario` na resposta de `GET /produtos/:sku`:

```ts
// ALTERAÇÃO TEMPORÁRIA (revertida em seguida):
const { preco, ...resto } = produto;
enviarJson(res, 200, { ...resto, precoUnitario: preco });
```

Rodando a verificação do provedor (`node --test packages/catalog/test/contract`),
o Pact acusa a incompatibilidade apontando **exatamente o campo faltante**:

```
Verifying a pact between qualicart-checkout and qualicart-catalog

  uma busca por um produto existente (CAM-001) (0s loading, 241ms verification)
    returns a response which
      has status code 200 (OK)
      includes headers
        "Content-Type" with value "application/json; charset=utf-8" (OK)
      has a matching body (FAILED)

  uma busca por um produto inexistente (INEXISTENTE-000) (0s loading, 227ms verification)
    returns a response which
      has status code 404 (OK)
      includes headers
        "Content-Type" with value "application/json; charset=utf-8" (OK)
      has a matching body (OK)

Failures:

1) Verifying a pact between qualicart-checkout and qualicart-catalog - uma busca por um produto existente (CAM-001)
    1.1) has a matching body
           $ -> Actual map is missing the following keys: preco

There were 1 pact failures
ERROR: pact-core@19.2.0: Verification unsuccessful
```

Repare no diagnóstico preciso:

```
"expected": "[\"nome\",\"preco\",\"sku\"]",
"actual":   "[\"nome\",\"precoUnitario\",\"sku\"]",
"mismatch": "Actual map is missing the following keys: preco",
"path": "$", "type": "BodyMismatch"
```

Ou seja: o Verifier compara a resposta real do catálogo com o contrato do
checkout e falha o CI do **provedor** antes de qualquer deploy — o bug que só
apareceria em produção é capturado no momento em que o catálogo tenta evoluir de
forma incompatível.

Em seguida, a alteração foi **revertida** e o provedor voltou a verificar com
sucesso (`git status packages/catalog/src` limpo). O código de produção do
catálogo não sofreu nenhuma mudança permanente.

## Limites do Pact (o que ele NÃO garante)

Contract testing é poderoso, mas tem escopo bem delimitado. O Pact verifica
**compatibilidade de forma/estrutura** entre consumidor e provedor. Ele **não**
cobre:

- **Lógica de negócio / correção dos dados.** O Pact confirma que `preco` é um
  número; não confirma que é o preço *certo*. Um catálogo que devolve
  `preco: -1` ou o preço de outro produto passa na verificação de contrato.
- **Performance, latência e resiliência.** O contrato não diz nada sobre tempo
  de resposta, throughput ou comportamento sob carga/timeout. (No QualiCart isso
  é tratado por experimentos de chaos e testes de resiliência, não por Pact.)
- **Segurança, autenticação e autorização** de ponta a ponta.
- **Estados e efeitos colaterais complexos** não descritos como *provider
  states* no contrato.
- **Cobertura além das interações declaradas.** O Pact só verifica os endpoints
  e cenários que o consumidor efetivamente declarou. Rotas ou campos que nenhum
  consumidor pediu não são testados.

Por isso o contract testing **complementa**, e não substitui, testes unitários
(lógica), testes de integração/e2e (fluxos reais) e testes de
carga/resiliência. Seu valor específico é dar, de forma barata e desacoplada, a
garantia de que provedor e consumidor **continuam falando a mesma língua** à
medida que evoluem separadamente.

## Como rodar

```bash
# Consumidor + provedor (gera/verifica o pact em pacts/)
npm run test:contract
```

- O teste do consumidor gera `pacts/qualicart-checkout-qualicart-catalog.json`.
- O teste do provedor lê esse arquivo committed (via `pactUrls`) e verifica o
  catálogo real subido no porto `3021`. Como a verificação lê o pact do arquivo,
  a ordem de execução entre consumidor e provedor não importa.
