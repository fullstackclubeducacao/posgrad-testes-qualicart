# Segurança no pipeline: SAST + SCA (DevSecOps)

> Módulo 3 — QualiCart. Este documento descreve os gates de **segurança
> shift-left** adicionados ao pipeline: um de **SAST** (analisa o nosso código)
> e um de **SCA** (analisa as nossas dependências). Traz também um **achado real**
> de SAST e como foi tratado, e o **retrato real** do `npm audit`.

---

## 1. As quatro siglas e a pergunta de cada uma

Testar segurança não é uma única coisa. Cada técnica olha para um ângulo
diferente do sistema e responde a uma pergunta diferente:

| Sigla    | Nome                                    | Pergunta que responde                                                        | Precisa rodar a aplicação? | Vê o quê? |
|----------|-----------------------------------------|------------------------------------------------------------------------------|----------------------------|-----------|
| **SAST** | Static Application Security Testing      | "O **meu código** tem padrões perigosos?" (injeção, secrets, regex ReDoS...) | Não (estática)             | Código-fonte (caixa-branca) |
| **DAST** | Dynamic Application Security Testing     | "A aplicação **em execução** é atacável pela borda?" (XSS, SQLi, headers...)  | Sim (caixa-preta)          | HTTP/comportamento externo |
| **SCA**  | Software Composition Analysis            | "As **dependências** que eu importo têm vulnerabilidades conhecidas?"          | Não (analisa o lockfile)   | Árvore de pacotes / advisories |
| **IAST** | Interactive Application Security Testing  | "Durante os **testes**, o fluxo real dispara alguma vulnerabilidade?"          | Sim (instrumentado)        | Código instrumentado em runtime |

Resumo mental:
- **SAST** = revisão automática do *meu* código (dentro, parado).
- **DAST** = pentest automatizado *de fora* (fora, correndo).
- **SCA** = inventário de risco das *bibliotecas de terceiros*.
- **IAST** = SAST + DAST fundidos: instrumenta a app e observa enquanto os
  testes exercitam os fluxos (dentro, correndo).

---

## 2. Onde cada uma entra no pipeline

Princípio **shift-left**: quanto mais cedo (e mais barato) o gate, mais cedo ele
roda. Custo de correção cresce quanto mais tarde o defeito é achado.

```
commit ─▶ [SAST] [SCA] ─▶ lint ─▶ typecheck ─▶ unit ─▶ integração ─▶ [DAST/IAST] ─▶ deploy
          └──── barato, cedo ────┘                         └── caro, precisa app de pé ──┘
```

- **SAST** e **SCA**: gates **baratos**, sem precisar subir nada. Entram junto do
  lint/typecheck, no começo do pipeline. **← foi o que adicionamos neste módulo.**
- **DAST**: exige a aplicação de pé (ex.: OWASP ZAP contra um ambiente de staging).
  Naturalmente mais tarde, junto/depois dos E2E.
- **IAST**: exige instrumentação em runtime durante a suíte de testes. Encaixa no
  estágio de integração/E2E, reaproveitando os testes que já rodam.

No QualiCart, DAST e IAST ficam como evolução; **SAST e SCA já são gates de PR**.

---

## 3. O gate de SAST que adicionamos (`eslint-plugin-security`)

Usamos o **`eslint-plugin-security`** como camada de SAST barata, integrada ao
mesmo motor de lint que já roda. Configuração no flat config (`eslint.config.js`):

```js
import pluginSecurity from 'eslint-plugin-security';

export default tseslint.config(
  // ...
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    ...pluginSecurity.configs.recommended,
  },
  // ...
);
```

**Decisão de severidade (intencional):** mantemos as regras de segurança como
`warn`, não `error` — o mesmo critério já usado para as regras de complexidade.
Motivo: o SAST **sinaliza** todos os achados (aparecem no lint e nos logs do CI),
mas um **falso positivo** não deve derrubar o gate local. O bloqueio "duro" fica
com o **SCA** (`npm audit --audit-level=high`) e com a revisão da saída do SAST no
CI. A evolução natural é apertar para `eslint . --max-warnings=<n>` conforme a
base é limpa, tornando qualquer achado NOVO um bloqueio.

### Retrato real do SAST (saída do `npm run lint`)

```
  chaos/comparativo-flag.mjs
    87:5   warning  Generic Object Injection Sink  security/detect-object-injection
    87:18  warning  Generic Object Injection Sink  security/detect-object-injection
  chaos/experimento-catalogo.mjs
    140:5   warning  Generic Object Injection Sink  security/detect-object-injection
    140:29  warning  Generic Object Injection Sink  security/detect-object-injection
  packages/checkout/src/flags.ts
    118:18  warning  Variable Assigned to Object Injection Sink  security/detect-object-injection
  packages/checkout/test/integration/pedido-repository.integration.ts
    60:23  warning  Found readFile from package "node:fs/promises" with non literal argument at index 0  security/detect-non-literal-fs-filename
  packages/checkout/test/unit/checkout-service.test.ts
    19:19  warning  Variable Assigned to Object Injection Sink  security/detect-object-injection

✖ 26 problems (0 errors, 26 warnings)
```

> Das 26 mensagens, 7 são do plugin de segurança (as demais são as regras de
> complexidade do Módulo 1). **0 erros** → o gate local segue verde.

Achados por regra:
- `security/detect-object-injection` (6x): acesso a objeto/array por chave
  dinâmica. Regra notoriamente propensa a **falso positivo** — dispara em
  qualquer `obj[chave]` mesmo quando a chave é interna e confiável.
- `security/detect-non-literal-fs-filename` (1x): `readFile` com caminho não
  literal. Só é risco quando o caminho vem de **entrada não confiável**.

### 3.1 Achado real analisado e tratado

**Achado:** `security/detect-non-literal-fs-filename`
**Arquivo:** `packages/checkout/test/integration/pedido-repository.integration.ts:60`
**Mensagem:** *Found readFile from package "node:fs/promises" with non literal
argument at index 0.*

Trecho apontado:

```ts
const schemaPath = fileURLToPath(
  new URL('../../src/schema.sql', import.meta.url),   // caminho FIXO, relativo ao módulo
);
// ...
const ddl = await readFile(schemaPath, 'utf8');       // <-- linha 60: argumento "não-literal"
await pool.query(ddl);
```

**Análise (por que é falso positivo seguro):** o "argumento não-literal" é uma
variável (`schemaPath`), mas seu valor é **totalmente controlado pelo próprio
código** — derivado de `import.meta.url` mais uma string literal (`../../src/
schema.sql`). **Nenhuma entrada de usuário** participa da construção do caminho.
Portanto não há risco de *path traversal* / leitura arbitrária de arquivo: a
regra dispara pela *forma* (variável, não literal), não por um risco real.
Trata-se, ainda, de código de **teste de integração**, que nem sequer roda em
produção.

**Tratamento adotado:** classificado como **falso positivo seguro** e mantido
como `warn` (sinal preservado, gate não quebra). A intenção está explícita no
`eslint.config.js`. Caso a política do time evolua para `--max-warnings=0`, a
supressão pontual recomendada — a ser aplicada na linha, por quem for dono do
arquivo — seria:

```ts
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo derivado de import.meta.url (schema.sql do próprio repo), sem entrada de usuário: sem risco de path traversal.
const ddl = await readFile(schemaPath, 'utf8');
```

**Contraexemplo (quando NÃO se suprime):** se o caminho viesse de um parâmetro de
request (ex.: `readFile(req.query.file)`), o achado seria **verdadeiro** e a
correção seria validar/normalizar o caminho (allowlist, `path.resolve` + checar
prefixo), nunca suprimir.

---

## 4. O gate de SCA que adicionamos (`npm audit`)

SCA analisa a **árvore de dependências** contra o banco de advisories do npm.
Adicionamos como gate de PR:

```bash
npm audit --audit-level=high   # falha o build só em severidade ALTA ou CRÍTICA
```

### Retrato real do `npm audit` (execução deste módulo)

Sumário por severidade (`npm audit --json` → `metadata.vulnerabilities`):

| Severidade | Contagem |
|------------|----------|
| critical   | 0        |
| high       | 0        |
| **moderate** | **7**  |
| low        | 0        |
| info       | 0        |
| **total**  | **7**    |

As advisories moderadas se resumem a **duas** raízes, ambas **transitivas de
devDependencies** (ferramentas de teste), sem qualquer presença na árvore de
runtime de produção:

| Advisory | Pacote | Cadeia (origem) | Tipo |
|----------|--------|-----------------|------|
| DoS em `qs.stringify` (comma-format arrays) | `qs` | `typed-rest-client` → **`@stryker-mutator/core`** | devDependency (mutação) |
| Bounds check ausente em `uuid` v3/v5/v6 | `uuid` | `@cucumber/messages`/`gherkin` → **`@cucumber/cucumber`** | devDependency (BDD) |

Resultado do gate:

```bash
$ npm audit --audit-level=high ; echo "exit: $?"
exit: 0        # nenhuma high/critical → gate PASSA
```

> **Dependência de RUNTIME (`pg`) está limpa.** `pg` é a única `dependency` de
> produção do projeto; ela e sua subárvore (`pg-pool`) **não têm advisories**.
> Se surgisse algo de severidade alta em `pg` (ou em qualquer dep de produção),
> `--audit-level=high` **quebraria o build** — que é exatamente o comportamento
> desejado.

### Estratégia de tratamento

1. **`npm audit fix` quando seguro:** para advisories corrigíveis sem *breaking
   change* (patch/minor semver-compatível), `npm audit fix` é a primeira opção.
   > Nota: neste momento **não** rodamos `npm audit fix` — as correções aqui ou
   > exigem `--force` (ex.: `uuid` puxaria `@cucumber/cucumber@13`, breaking) ou
   > dependem do upstream (`stryker`/`typed-rest-client`) publicar release.
2. **Aceitar/justificar quando é transitivo de ferramenta de teste sem impacto
   em produção:** os 7 achados são **moderados** e vivem só em devDependencies
   (stryker, cucumber). Não entram no bundle de produção. Um DoS em `qs.stringify`
   ou um bounds check de `uuid` dentro de uma ferramenta de mutação/BDD que roda
   no CI não expõe o serviço em runtime. Por isso o gate é `--audit-level=high`:
   **barra o que importa** (alto/crítico, sobretudo em runtime) sem virar ruído
   por moderadas de tooling.
3. **Foco no que é runtime:** advisory de alta severidade em `pg` ou na árvore de
   produção é tratada como **incidente** — prioridade máxima, atualiza-se já.

---

## 5. Onde os gates entram no CI

Adicionados cedo (`.github/workflows/ci.yml`), junto dos gates baratos:

- **`sast`** — roda `npm run lint` (ESLint com o `eslint-plugin-security`
  carregado). Rótulo dedicado para deixar o SAST visível no pipeline.
- **`sca`** — roda `npm audit --audit-level=high`. **Falha o build** em
  vulnerabilidade alta/crítica.

Ambos são independentes e paralelos aos demais gates baratos (lint/typecheck),
antes dos testes e do E2E. **Shift-left na prática.** YAML validado com
`yaml.safe_load` (PyYAML).

---

## 6. DevSecOps: segurança como qualidade contínua

DevSecOps é o mesmo princípio da disciplina toda — **qualidade não é fase final,
é gate contínuo** — aplicado à segurança:

- **Shift-left:** achar cedo é barato; achar em produção é caro (e pode ser um
  vazamento). SAST/SCA no PR evitam que a dívida de segurança acumule.
- **Automatizado e repetível:** o gate roda igual para todo mundo, todo PR. Não
  depende de alguém "lembrar" de revisar segurança.
- **Sinal ≠ bloqueio:** distinguimos *reportar* (warn, para não afogar o time em
  falso positivo) de *bloquear* (audit high/critical, achados verdadeiros). Um
  gate que grita por tudo é ignorado; um que só barra o que importa é respeitado.
- **Defesa em profundidade:** SAST (meu código) + SCA (dependências) cobrem
  ângulos complementares; DAST e IAST são a evolução para cobrir o runtime.
- **Falso positivo tratado com rastro:** todo achado suprimido carrega
  justificativa (`// eslint-disable-next-line ... -- motivo`), preservando a
  auditabilidade — a supressão é uma decisão documentada, não um silêncio.

Segurança, aqui, é só mais uma dimensão da **qualidade contínua**: medida a cada
commit, com gates baratos primeiro, feedback rápido e decisões rastreáveis.
</content>
</invoke>
