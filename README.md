# QualiCart — Módulo 1: Fundação de Qualidade

O **QualiCart** é o projeto-fio-condutor da disciplina *Estratégias de Testes e Qualidade de Software*. Trata-se de um mini e-commerce de checkout (carrinho, cupons e frete) escrito em **Node.js + TypeScript**, executado pelo **interpretador TypeScript nativo do Node** — ou seja, sem build, sem transpilação e sem pasta `dist/`.

O repositório é **evolutivo**: cada módulo da disciplina vive em sua própria branch, para que você acompanhe a evolução da qualidade comparando estados com `git diff`. Você está na branch **`modulo-1`**, que transforma o starter (um monólito com testes fracos e sem CI) em uma **fundação de qualidade**: testes de unidade via TDD, um cenário BDD, um pipeline de CI com *quality gates* e cobertura, além dos documentos de diagnóstico e reflexão que sustentam essas decisões. O marco desta branch é a tag `m1-final`.

---

## Mapa de branches

Este repositório é lido por branch. Cada uma representa um estágio de maturidade do QualiCart:

| Branch | O que representa |
| --- | --- |
| `main` / `inicio` | **Starter** entregue ao aluno: monólito de checkout, testes fracos, *code smells* e sem CI. |
| **`modulo-1`** | **Esta branch.** Fundação de qualidade: TDD, BDD, CI com *gates*, cobertura e diagnóstico. Tag: `m1-final`. |
| `modulo-2` *(futuro)* | Split em catálogo + checkout, contratos com Pact, testcontainers, Playwright, k6, chaos, *property/mutation testing*. |
| `modulo-3` *(futuro)* | SAST/SCA, SLO e *error budget*, *feature flags*/canary, OpenTelemetry, acessibilidade, *visual regression*. |
| `modulo-4` *(futuro)* | Assistente de IA, *golden dataset*, evals (Promptfoo), defesas de runtime, *red teaming*, testes A/B. |

Para navegar entre os estágios:

```bash
git checkout modulo-1          # entra nesta branch
git diff inicio modulo-1       # vê exatamente o que o Módulo 1 acrescentou
git log --oneline              # lê a história de commits (inclui o ciclo TDD)
```

---

## O que o Módulo 1 acrescentou

Sobre o starter (`inicio`), esta branch entrega:

1. **Suíte de unidade construída por TDD.** A regra de cupom (`packages/checkout/src/coupon.ts`) foi reconstruída pelo ciclo *red → green → refactor* — visível em três commits separados no `git log`. O ciclo revelou e corrigiu um **bug de fronteira**: o cupom não valia quando o subtotal era **exatamente igual** ao mínimo exigido pelo carrinho. Há suítes de unidade para carrinho, cupom e frete:
   - `packages/checkout/test/unit/cart.test.ts`
   - `packages/checkout/test/unit/coupon.test.ts`
   - `packages/checkout/test/unit/shipping.test.ts`
2. **Cenário BDD em Gherkin (português).** A especificação executável `features/aplicar-cupom.feature` descreve a aplicação de cupom em linguagem de negócio; as *step definitions* ficam em `features/steps/aplicar-cupom.steps.ts`, com configuração em `cucumber.mjs`. As steps `.ts` são carregadas **diretamente** pelo interpretador nativo do Node (sem transpilador). Rode com `npm run bdd`.
3. **Pipeline de CI com *quality gates*.** O workflow `.github/workflows/ci.yml` (GitHub Actions) organiza os *gates* do **mais barato ao mais caro** (*fail fast*): `lint` e `typecheck` rodam em **paralelo**; `test` (com **gate de cobertura nativo do Node**) só roda se ambos passarem; e `bdd` fica por último. A cobertura é tratada como **piso** (mínimo aceitável), nunca como teto — limiares: linhas `0.75`, funções `0.75`, ramos `0.65`.
4. **Documentos de estratégia** em `docs/modulo-1/`:
   - `diagnostico-estrategia.md` — pirâmide vs. troféu, três *code smells* do código e a dívida técnica assumida.
   - `reflexao-cobertura.md` — por que cobertura mede **execução, não verificação**, ilustrado com um caso real do projeto.

---

## Stack e filosofia de execução nativa

O ponto pedagógico da stack é: **rodar TypeScript sem pipeline de build**.

- **Node.js >= 24** (recomendado **26**). Nenhuma ferramenta de build é necessária.
- **Type stripping nativo**: o Node apaga as anotações de tipo em tempo de execução e roda o JavaScript resultante. Não há transpilação, nem `dist/`, nem *sourcemaps*.
- **Test runner nativo**: os testes usam `node --test`, sem Jest/Vitest.
- **Cobertura nativa**: via `node --test --experimental-test-coverage`, com *gate* aplicado pelos flags `--test-coverage-lines/functions/branches`.
- **Imports com extensão `.ts` explícita** (ex.: `import { aplicarCupom } from './coupon.ts'`), exigidos pelo resolvedor do Node em modo nativo.
- **`erasableSyntaxOnly`** no `tsconfig.json`: proíbe recursos de TS que *não são* apagáveis (como `enum` ou `namespace` com runtime), garantindo que todo o código seja compatível com o type stripping. O `typecheck` (`tsc --noEmit`) serve só de verificador — nunca gera arquivos.

---

## Como rodar

Todos os scripts são declarados em `package.json`. Resultados abaixo já validados nesta branch:

```bash
npm install            # instala as devDependencies (typescript, eslint, typescript-eslint,
                       # @types/node, @cucumber/cucumber, @eslint/js)

npm start              # sobe o servidor HTTP do checkout em http://localhost:3000
                       # (porta configurável via variável de ambiente PORT)

npm test               # roda a suíte com node --test  -> 23 testes, todos verdes
npm run test:coverage  # mesma suíte com cobertura nativa
                       # (linhas ~90%, funções 100%, ramos ~91%)

npm run typecheck      # tsc --noEmit                   -> 0 erros
npm run lint           # ESLint                         -> 0 erros
                       # (há warnings de complexidade INTENCIONAIS — detectores de smell)
npm run bdd            # Cucumber                        -> 5 cenários, 15 steps, verdes
```

> Sobre a cobertura: o domínio (`cart.ts`, `coupon.ts`, `shipping.ts`) fica em **100%**; o orquestrador `checkout.ts` permanece **parcialmente coberto de propósito** — ele é o ponto de partida das atividades de refatoração dos próximos módulos.

### Exemplo de requisição

Com o servidor no ar (`npm start`), envie um checkout ao endpoint `POST /checkout`:

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{
    "itens": [
      { "sku": "CAM-001", "nome": "Camiseta", "precoUnitario": 59.9, "quantidade": 2 },
      { "sku": "CAN-001", "nome": "Caneca",   "precoUnitario": 39.9, "quantidade": 1 }
    ],
    "cupom": { "tipo": "percentual", "valor": 10 },
    "cep": "01000-000"
  }'
```

Resposta (JSON com o detalhamento de valores):

```json
{
  "subtotal": 159.7,
  "desconto": 15.97,
  "frete": 15,
  "total": 158.73
}
```

O corpo aceita ainda os campos opcionais `nomeCliente`, `emailCliente`, `freteGratisVip` e `observacao` (ver `packages/checkout/src/server.ts` e `packages/checkout/src/checkout.ts`).

---

## Estrutura de pastas

```text
qualicart/
├─ .github/
│  └─ workflows/
│     └─ ci.yml                     # pipeline de quality gates (lint, typecheck, test+cobertura, bdd)
├─ docs/
│  └─ modulo-1/
│     ├─ diagnostico-estrategia.md  # pirâmide vs. troféu, code smells, dívida técnica
│     └─ reflexao-cobertura.md      # cobertura mede execução, não verificação
├─ features/
│  ├─ aplicar-cupom.feature         # cenário BDD em Gherkin (pt)
│  └─ steps/
│     └─ aplicar-cupom.steps.ts     # step definitions (.ts carregadas nativamente)
├─ packages/
│  └─ checkout/
│     ├─ public/
│     │  └─ index.html              # UI mínima servida na raiz "/"
│     ├─ src/
│     │  ├─ cart.ts                 # carrinho: tipos + cálculo de subtotal
│     │  ├─ coupon.ts               # regras de cupom (reconstruída via TDD)
│     │  ├─ shipping.ts             # cálculo de frete por região/CEP
│     │  ├─ checkout.ts             # orquestrador (monolítico de propósito)
│     │  └─ server.ts               # servidor HTTP nativo (node:http)
│     └─ test/
│        ├─ checkout.test.ts        # testes do orquestrador
│        └─ unit/
│           ├─ cart.test.ts
│           ├─ coupon.test.ts
│           └─ shipping.test.ts
├─ cucumber.mjs                     # config do Cucumber (paths + import de steps .ts)
├─ eslint.config.js                 # ESLint (flat config) com regras de complexidade
├─ tsconfig.json                    # tsc --noEmit, erasableSyntaxOnly, imports .ts
└─ package.json                     # scripts e devDependencies (workspaces)
```

---

## O ciclo TDD nesta branch

A reconstrução da regra de cupom seguiu o ciclo *red → green → refactor*, deixando cada passo registrado como um commit próprio. Veja com `git log --oneline`:

```text
test(checkout): cupom deve valer no mínimo exato do carrinho (red)
fix(checkout):  aplica cupom no mínimo exato do carrinho (green)
refactor(checkout): extrai verificação de mínimo do cupom (refactor)
```

O que cada passo fez:

1. **(red)** — Escreveu-se primeiro um teste que **falha**: ele afirma que um cupom com `minimoCarrinho` deve valer quando o subtotal é **exatamente igual** ao mínimo. O código antigo usava uma comparação estrita e rejeitava esse caso de fronteira, então o teste ficou vermelho.
2. **(green)** — Fez-se a **menor mudança** que torna o teste verde: a comparação passou a aceitar a igualdade (`subtotal >= minimoCarrinho`). Nada além do necessário.
3. **(refactor)** — Com a rede de testes verde, **melhorou-se o design** sem alterar comportamento: a checagem de mínimo foi extraída para a função `atingiuMinimo`, deixando `aplicarCupom` legível e a intenção explícita.

Esse é o valor do TDD demonstrado na prática: o teste **encontrou e corrigiu** um bug de fronteira real, e o passo de refatoração pôde ser feito com segurança porque a suíte protege o comportamento.

---

## Próximo passo

O **Módulo 2** parte desta fundação para dividir o QualiCart em serviços (catálogo + checkout) e subir o nível dos testes: contratos com Pact, testcontainers, testes de ponta a ponta com Playwright, carga com k6, *chaos* e *property/mutation testing*. Quando chegar lá, use `git diff modulo-1 modulo-2` para ver a evolução.
