# QualiCart — Starter

O **QualiCart** é o projeto-fio-condutor da disciplina *Estratégias de Testes e Qualidade de Software*. Ele é um mini e-commerce de checkout e este repositório é o **ponto de partida** que você recebe: a partir daqui vamos evoluir os testes, a qualidade e o design do código ao longo do curso.

## Domínio

O QualiCart modela o fluxo de finalização de compra de um carrinho:

- **Carrinho**: uma lista de itens (SKU, nome, preço unitário e quantidade) da qual se calcula o subtotal.
- **Cupons**: descontos do tipo percentual ou de valor fixo, com um valor mínimo de carrinho opcional para serem válidos.
- **Frete**: cálculo por região (usando o CEP) com regra de frete grátis acima de um limiar.
- **Checkout**: orquestra carrinho, cupom e frete e devolve o detalhamento de `subtotal`, `desconto`, `frete` e `total`.

## Requisitos

- **Node.js >= 24** (recomendado **Node.js 26**).
- Nenhuma ferramenta de build é necessária. O projeto roda arquivos `.ts` **diretamente** pelo interpretador nativo do Node.js (*type stripping*), ou seja, **sem etapa de transpilação/build** e sem pasta `dist/`. O Node apaga os tipos em tempo de execução e roda o JavaScript resultante.

## Como rodar

```bash
npm install     # instala as devDependencies (typecheck, lint, bdd)
npm start       # sobe o servidor HTTP (por padrão em http://localhost:3000)
npm test        # roda os testes com o test runner nativo (node --test)
```

Scripts adicionais:

```bash
npm run typecheck   # checagem de tipos com tsc --noEmit (não gera JS)
npm run lint        # ESLint (pode emitir warnings de complexidade)
```

## Exemplo de requisição

Com o servidor no ar (`npm start`), envie um checkout:

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{
    "itens": [
      { "sku": "CAM-001", "nome": "Camiseta", "precoUnitario": 59.9, "quantidade": 2 },
      { "sku": "CAN-001", "nome": "Caneca", "precoUnitario": 39.9, "quantidade": 1 }
    ],
    "cupom": { "tipo": "percentual", "valor": 10 },
    "cep": "01000-000"
  }'
```

Resposta esperada (JSON):

```json
{
  "subtotal": 159.7,
  "desconto": 15.97,
  "frete": 15,
  "total": 158.73
}
```

## Nota sobre a cobertura de testes

A suíte de testes deste starter é **intencionalmente fraca**: cobre apenas alguns caminhos felizes e deixa boa parte da lógica de negócio (cupons, frete, casos de fronteira) sem verificação real. Isso é proposital — melhorar essa cobertura e a qualidade do código faz parte das atividades da disciplina. Há bastante espaço para você adicionar testes e refatorar.
