# Notificações, configuração, briefings sob demanda, RSS e temas automáticos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Corrigir ativação de notificações, tornar a configuração visível, permitir briefings sob demanda, incluir RSS recente no briefing pessoal e trocar a taxonomia fixa por temas automáticos consolidados.

**Architecture:** Mantém SQLite/Drizzle, a fila `collector_runs` com lease, o worker sequencial e as Server Actions autenticadas. As mudanças de banco seguem o padrão de SQL bruto idempotente de `src/db/taxonomy.ts`. A leitura de configuração passa a ter um único leitor, compartilhado por site e worker.

**Tech Stack:** TypeScript strict, Next.js 16 App Router, React 19, better-sqlite3 + Drizzle, zod, web-push, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-briefings-push-themes-design.md`

## Global Constraints

- Trabalhar somente em `/home/pedro/.t3/projects/orbit/.claude/worktrees/orbit-briefings-push`. Sem commit, push, publicação, merge ou TrueNAS. O passo "Commit" de cada tarefa é substituído por "deixar o diff pronto, sem commit".
- Interface em pt-BR. Toda Server Action exportada e toda página de `(app)` começa com `await requireSession()` (exigido por `tests/session-guard.test.ts`).
- Nenhum segredo, endpoint de push, chave ou contato de e-mail em client components, mensagens ou diagnósticos. Nunca repassar texto bruto do Zod ou do SDK.
- IA só no worker. Nenhuma chamada de IA no render. Escritas do worker dentro de `owned()`/transação IMMEDIATE com verificação de lease.
- Testes com `ORBIT_ENV_FILE=""` (já forçado por `vitest.config.ts`) e fixtures sintéticas. Nunca usar chave ou endpoint reais.
- Não adicionar dependências. Não mudar a versão em `package.json`.
- Leitor de arquivo: `AI_*`, `ORBIT_PUSH_SUBJECT`, `COLLECTOR_CRON`, `COLLECTOR_TIMEZONE`, `COLLECTOR_MAX_RUNS_PER_DAY`, `COLLECTOR_MAX_ITEMS`, `SCHEDULER_ENABLED`. `ORBIT_ALLOWED_HOSTS`, `PORT`, `ORBIT_HOST`, `ORBIT_DB_PATH`, `ORBIT_ENV_FILE`, `ORBIT_BACKUP_DIR` e `TZ` continuam só no ambiente.
- Limites: prazo de 30 s no navegador; 5 min entre pedidos manuais do mesmo tipo; até 3 notícias RSS por briefing; descrição de notícia com até 1.500 caracteres; recorrência de 3 itens pessoais; catálogo com até 40 temas; até 20 grupos em observação no payload.

## Review Focus

- **Arquivo `orbit.env` ilegível ou diretório:** o painel mostra "ilegível", o worker não cai e a IA fica sem configuração, sem usar os `AI_*` do contêiner. Teste na Tarefa 1.
- **Navegador cuja promessa nunca resolve (Helium):** o botão volta a ficar disponível com a mensagem de prazo e sem chamar `subscribe` duas vezes. E2E na Tarefa 4.
- **Proposta com alias que já pertence a uma semente ("Mobilidade"):** o alias é descartado, nenhum item é movido da semente e a proposta continua. Teste na Tarefa 6.
- **Briefing com notícia externa que o modelo não cita:** é aceito; omitir item pessoal continua sendo rejeitado. Teste na Tarefa 9.
- **Clique duplo em "Gerar briefing geral agora" com o worker offline:** apenas uma edição é enfileirada, e a mensagem informa o estado do worker. Teste na Tarefa 8.

---

### Task 1: Leitor único de configuração

**Files:**
- Modify: `src/lib/ai-environment.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/lib/scheduler.ts`
- Modify: `src/lib/editions.ts:7-19`
- Modify: `src/lib/push.ts:53-61`
- Modify: `src/collectors/registry.ts:12`
- Modify: `src/lib/extension.ts:93,131`
- Test: `tests/ai-environment.test.ts`, `tests/config.test.ts`, `tests/scheduler.test.ts`, `tests/push.test.ts`

**Interfaces:**
- Produces, em `src/lib/ai-environment.ts`:
  ```ts
  export const FILE_KEYS: readonly string[]; // as 6 chaves não-AI acima
  export type EnvSource = "arquivo" | "ambiente" | "ausente";
  export type EnvironmentFile = { label: string; state: "não usado" | "ausente" | "ilegível" | "carregado" };
  export type Environment = { env: Record<string, string | undefined>; source(key: string): EnvSource; file: EnvironmentFile; ignoredContainerAI: string[] };
  export function readEnvironment(base?: Record<string, string | undefined>): Environment;
  export function readAIEnvironment(base?: Record<string, string | undefined>): Record<string, string | undefined>; // = readEnvironment(base).env
  ```
  - `file.label` é o valor de `ORBIT_ENV_FILE`, quando preenchido; ".env / .env.local" sem ele; "desativado" com valor vazio. Nunca um caminho absoluto resolvido.
- Produces, em `src/lib/config.ts`:
  ```ts
  export type ModelStatus = { model: string | null; source: EnvSource; state: "carregado" | "ausente" | "inválido" | "incompleto"; reason: string | null; lastSuccessAt: number | null };
  export function briefingProblem(env?: Record<string, string | undefined>): string | null; // null = briefing utilizável
  export function aiStatus(db?: OrbitDB): /* campos atuais */ & { file: EnvironmentFile; endpoint: { protocol: string; host: string } | null; apiKey: "definida" | "ausente"; classification: ModelStatus; briefing: ModelStatus; pushContact: { state: "definido" | "ausente" | "inválido"; source: EnvSource }; ignoredContainerAI: string[] };
  ```
- Produces: `ScheduleConfig` ganha `origin: "interface" | "arquivo" | "ambiente" | "padrão"`; `EditionSchedule` ganha `origin: "interface" | "coleta" | "arquivo" | "ambiente" | "padrão"`; e `queueScheduledRun(db, owner, now?, env?)`.

- [x] **Step 1: Escrever os testes que falham**

  Em `tests/ai-environment.test.ts`, com arquivo temporário e `vi.stubEnv`:
  - `"ORBIT_PUSH_SUBJECT do arquivo vence o contêiner vazio"`: `readEnvironment({ ORBIT_ENV_FILE: file, ORBIT_PUSH_SUBJECT: "" })`; espera `env.ORBIT_PUSH_SUBJECT === "mailto:a@exemplo.org"` e `source("ORBIT_PUSH_SUBJECT") === "arquivo"`.
  - `"COLLECTOR_TIMEZONE do ambiente vale sem chave no arquivo"`: espera `source === "ambiente"`.
  - `"AI_* do contêiner é ignorado quando o arquivo existe"`: espera `ignoredContainerAI` contendo `"AI_MODEL"` e `env.AI_MODEL` indefinido.
  - `"arquivo ilegível não lança"`: com `ORBIT_ENV_FILE` apontando para um diretório, espera `file.state === "ilegível"`, `env.AI_MODEL` indefinido mesmo com `AI_MODEL` no ambiente, e `file.label` igual ao caminho configurado.
  - `"não escreve em process.env"`: compara um snapshot de `process.env` antes e depois.

  Em `tests/config.test.ts`:
  - `"briefingProblem cita a variável que falta"`: sem `AI_MODEL`, com `AI_BRIEFING_MODEL`, `AI_BASE_URL` e `AI_API_KEY`, a mensagem contém `AI_MODEL`. Sem `AI_BASE_URL`, contém `AI_BASE_URL`. Com `AI_DAILY_USD_LIMIT` e sem preços de briefing, contém `AI_BRIEFING_INPUT_USD_PER_MILLION`. Com tudo válido, `null`.
  - `"limites inválidos citam a variável"`: `AI_DAILY_TOKEN_LIMIT=abc` faz `aiStatus().message` conter `AI_DAILY_TOKEN_LIMIT` e não conter `abc`.
  - `"diagnóstico não expõe segredos"`: `JSON.stringify(aiStatus(db))` não contém a chave de teste, o e-mail do contato nem o caminho da URL. `endpoint.host === "api.exemplo.org:8443"`.
  - `"último sucesso por modelo"`: insere `processed_items` com `model` e `processedAt = 123`; espera `classification.lastSuccessAt === 123`.

  Em `tests/scheduler.test.ts`:
  - `"SCHEDULER_ENABLED inválido cita a variável"`: `readSchedule(db, { SCHEDULER_ENABLED: "sim" }).error` contém `SCHEDULER_ENABLED`.
  - `"COLLECTOR_MAX_RUNS_PER_DAY inválido cita a variável"`: com `"99"`, o erro contém `COLLECTOR_MAX_RUNS_PER_DAY`.
  - `"origem da agenda"`: sem `scheduler_config`, `origin` é `"padrão"`; com `COLLECTOR_CRON` no env, `"ambiente"`; depois de salvar, `"interface"`.

  Em `tests/push.test.ts`:
  - `"contato de push vindo do arquivo"`: com `ORBIT_ENV_FILE` temporário contendo `ORBIT_PUSH_SUBJECT=mailto:orbit@exemplo.org` e o ambiente vazio, `pushConfiguration(db).publicKey` tem 87 caracteres.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/ai-environment.test.ts tests/config.test.ts tests/scheduler.test.ts tests/push.test.ts`

  Expected: FAIL (`readEnvironment` não existe, mensagens antigas).

- [x] **Step 3: Implementar `readEnvironment`**

  - Para cada arquivo existente, usar `statSync().isFile()` e `readFileSync` com `try/catch`. Erro vira `ilegível`.
  - A regra de `AI_*` não muda: a existência de qualquer arquivo candidato remove os `AI_*` do ambiente.
  - Para as `FILE_KEYS`, a ordem é: valor não vazio do arquivo, depois valor não vazio do ambiente.
  - `source` é calculado por chave.

- [x] **Step 4: Aplicar `readEnvironment` aos leitores**

  - `subject(env = readEnvironment().env)` em `push.ts`.
  - `readSchedule(db, env = readEnvironment().env)`: validar `SCHEDULER_ENABLED ∈ {"true","false"}` e `COLLECTOR_MAX_RUNS_PER_DAY` com mensagens próprias, e preencher `origin`.
  - `queueScheduledRun` lê `env` antes de `db.transaction` e passa para `readSchedule`.
  - `readEditionSchedule(db, env = readEnvironment().env)` preenche `origin`: `"interface"` se `edition_schedule` está salvo; `"coleta"` se herdou de `scheduler_config`; `"arquivo"`/`"ambiente"` se veio de `COLLECTOR_TIMEZONE`; senão `"padrão"`.
  - `COLLECTOR_MAX_ITEMS` passa a vir de `readEnvironment().env` em `registry.ts` e `extension.ts`.

- [x] **Step 5: Implementar `briefingProblem` e o `aiStatus(db?)` estendido**

  - `number(name, env, fallback)` lança `AIConfigurationError(\`${name} inválido: …\`)`.
  - `getBriefingConfig` reporta os nomes `AI_BRIEFING_*`.
  - `lastSuccessAt`:
    - classificação: `max(processed_items.processedAt) where model = AI_MODEL`;
    - briefing: o maior valor entre `max(briefings.createdAt)` e `max(editions.generatedAt)` publicadas, filtrando pelo modelo de briefing.
  - Sem `db`, `lastSuccessAt` fica `null`.

- [x] **Step 6: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/ai-environment.test.ts tests/config.test.ts tests/scheduler.test.ts tests/push.test.ts tests/editions.test.ts tests/worker-schedule.test.ts && npm run typecheck`

  Expected: PASS.

- [x] **Step 7: Deixar o diff pronto, sem commit**

### Task 2: Painel "Configuração reconhecida" e motivos verdadeiros

**Files:**
- Modify: `src/app/(app)/configuracoes/page.tsx:54-68`
- Modify: `src/app/(app)/status/page.tsx:18,29,37`
- Modify: `src/lib/run.ts:17-29,79-86`
- Modify: `src/ai/edition.ts:101`
- Modify: `src/app/(app)/briefing.tsx:13-17`
- Test: `tests/briefing.test.ts`, `tests/e2e/orbit.spec.ts`

**Interfaces:**
- Consumes: `aiStatus(db)` e `briefingProblem(env)` (Task 1).

- [x] **Step 1: Escrever os testes que falham**

  - `tests/briefing.test.ts`, `"aviso do briefing nomeia a falta real"`: `runWithConfiguredAI` com `AI_BRIEFING_MODEL` definido e sem `AI_BASE_URL` (env de arquivo temporário) grava um `briefing_notice` que contém `AI_BASE_URL` e não começa com `Configure AI_BRIEFING_MODEL`.
  - `tests/e2e/orbit.spec.ts`, `"configuração reconhecida sem segredos"`: em `/configuracoes#ia`, o heading "Configuração reconhecida" está visível, há linhas "Modelo de classificação" e "Modelo de briefing", e o HTML não contém o valor de `AI_API_KEY` do ambiente e2e.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/briefing.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar**

  - **`run.ts`:** usar `briefingProblem(env)` nos pontos 25-26 e 86, e repassar a mensagem a `runEdition`.
  - **`edition.ts`:** na linha 101, usar a mensagem recebida.
  - **`briefing.tsx`:** usar `aiStatus(db).briefing`.
  - **`configuracoes/page.tsx`:**
    - Criar a `<dl className="detail-list">` "Configuração reconhecida", com as linhas da spec: arquivo, protocolo, endpoint, chave, classificação, briefing, limites, contato de notificações, agenda e edições gerais. Cada linha mostra o valor e a origem.
    - Mostrar o aviso de `ignoredContainerAI`.
    - Trocar o texto de recarga por: "Valores do arquivo valem na próxima leitura, sem reiniciar. Valores definidos no ambiente do contêiner exigem recriar o contêiner. Hosts permitidos, porta e banco ficam só no ambiente."
    - Datas com `toLocaleString("pt-BR")`. Sem sucesso: "Nenhum sucesso com este modelo ainda".
  - **`status/page.tsx`:** acrescentar a linha "Modelos" com `Classificação: X · Briefing: Y` e link para `/configuracoes#ia`.

- [x] **Step 4: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/briefing.test.ts tests/session-guard.test.ts && npm run typecheck`

  Expected: PASS.

- [x] **Step 5: Deixar o diff pronto, sem commit**

### Task 3: Push no servidor e no worker

**Files:**
- Modify: `src/lib/push.ts:80-106,157-203`
- Modify: `src/app/push-actions.ts`
- Modify: `src/worker.ts:74-79`
- Test: `tests/push.test.ts`, `tests/worker.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PushConfiguration = { publicKey: string | null; subscribed: boolean; message: string; contact: "ok" | "ausente" | "inválido"; workerOnline: boolean; lastDelivery: { kind: "test" | "edition"; status: string; at: number } | null };
  ```
  - `testPush` passa a avisar quando o worker está offline: "Teste na fila, mas o worker está sem sinal recente; ele será enviado quando o worker voltar."

- [x] **Step 1: Escrever os testes que falham** (`tests/push.test.ts`)
  - `"endpoint fora da lista não derruba a configuração"`: `pushConfiguration(db, "https://wns2-par02p.notify.windows.com/w/?token=abc")` não lança, retorna `publicKey` com 87 caracteres e `subscribed === false`.
  - `"remover endpoint inválido é no-op"`: `removePushSubscription(db, "https://exemplo.org/x")` não lança, e a contagem de inscrições não muda.
  - `"último envio deste aparelho sem endpoint"`: depois de enfileirar e drenar um teste com o transporte simulado (HTTP 201), `pushConfiguration(db, endpoint).lastDelivery` vale `{ kind: "test", status: "sent" }`, e o JSON não contém o endpoint.
  - `"drainPush ocioso não abre transação de escrita"`: espionar `db.transaction` sem nenhuma entrega `queued`; zero chamadas.
  - `"inscrição removida na fronteira vira cancelled"`: remover a inscrição depois do claim e antes do envio; o status final é `cancelled`.

  Em `tests/worker.test.ts`:
  - `"erro transitório em drainPush não encerra o worker"`: com o padrão de processo filho existente, simular `drainPush` lançando um erro comum com o lease válido; o processo continua ativo e o heartbeat avança.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/push.test.ts tests/worker.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar**

  - **Endpoint:** guarda de endpoint que não lança em `pushConfiguration`, com `try { id = subscriptionId(endpointURL(endpoint).href) } catch { subscribed = false }`. `removePushSubscription` retorna sem efeito para endpoint inválido.
  - **Campos novos:** preencher `contact`, `workerOnline` (`workerOnline(db)`) e `lastDelivery` (última linha de `push_deliveries` com aquele `subscriptionId`).
  - **`drainPush`:**
    - Fazer leitura simples de existência de `queued` antes de qualquer `owned()`.
    - Distinguir os erros da fronteira: vencida → `expired`; desativada → `cancelled`; o resto → `failed`.
  - **`worker.ts`:** no `catch` de `drainPush`, chamar `assertActive()` dentro de `try`. Se lançar, `active = false; stopping = true`; senão, `console.error("Falha ao enviar notificações; nova tentativa no próximo ciclo.")` sem detalhes.

- [x] **Step 4: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/push.test.ts tests/worker.test.ts tests/edition-generation.test.ts`

  Expected: PASS.

- [x] **Step 5: Deixar o diff pronto, sem commit**

### Task 4: Painel de notificações no navegador

**Files:**
- Modify: `src/app/push-settings.tsx`
- Create: `tests/e2e/push.spec.ts`
- Modify: `docs/push.md`

**Interfaces:**
- Consumes: `PushConfiguration` (Task 3).

- [x] **Step 1: Escrever o e2e que falha**

  Arquivo `tests/e2e/push.spec.ts`, com o fixture de `tests/e2e/fixtures.ts`.

  Teste `"subscribe que nunca termina libera o botão com mensagem de prazo"`:
  - Preparação:
    - `page.addInitScript` substitui `PushManager.prototype.subscribe` por `() => new Promise(() => {})`, `Notification.requestPermission` por `async () => "granted"`, e `PushManager.prototype.getSubscription` por `async () => null`.
    - Usar `page.clock` para avançar 31 s.
    - O servidor e2e precisa de `ORBIT_PUSH_SUBJECT` sintético; conferir `playwright.config.ts` e acrescentar `mailto:e2e@exemplo.org` ao env do webServer, se faltar.
  - Esperado:
    - Depois de clicar em "Ativar neste aparelho", o texto contém "não respondeu em 30 segundos".
    - O botão "Ativar neste aparelho" volta a ficar habilitado.
    - `subscribe` foi chamado uma única vez, mesmo com um segundo clique durante a espera.

  Teste `"AbortError explica navegador sem serviço de push"`: com `subscribe` rejeitando `new DOMException("Registration failed - push service error", "AbortError")`, o texto contém "serviços do Google" e "Helium".

- [x] **Step 2: Rodar e confirmar que falha**

  Run: `npx playwright test tests/e2e/push.spec.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar no componente**

  - **Prazo:** helper local `within<T>(promise: Promise<T>, ms = 30_000): Promise<T>`, rejeitando com `new DOMException("prazo", "TimeoutError")`. Envolver `getRegistration`, `getSubscription`, `ready`, `subscribe`, `unsubscribe` e as quatro Server Actions. Não envolver `requestPermission`.
  - **Execução única:** `useRef<boolean>` impede um segundo `subscribe` enquanto o primeiro não terminar.
  - **Mensagens por `error.name`** (texto exato):
    - `TimeoutError`: "O navegador não respondeu em 30 segundos. Ele pode estar bloqueando o serviço de notificações. Recarregue a página ou use outro navegador."
    - `AbortError`: "O navegador não conseguiu se registrar no serviço de notificações. Navegadores sem serviços do Google, como Helium e ungoogled-chromium, geralmente não recebem notificações web; use Chrome, Firefox, Safari ou o celular."
    - `NotAllowedError`: mensagem de permissão atual.
    - `InvalidStateError`: tratado pela troca de chave.
    - Outros: "Não foi possível ativar (" + name + "). Tente novamente."
  - **Chave divergente:** chamar `unsubscribePush(existing.endpoint)` (ignorando erro), `existing.unsubscribe()` e seguir com um novo `subscribe`.
  - **Suporte por partes:**
    - sem `isSecureContext`: "Abra o Orbit por HTTPS.";
    - sem `serviceWorker`: "Este navegador não permite service workers neste site.";
    - sem `PushManager`/`Notification`: a mensagem atual do iOS e Tela de Início.
  - **Estado e bloqueio:**
    - "Estado neste aparelho" combina os estados: ativadas (navegador e servidor); "inscrição local não reconhecida pelo servidor: clique em Ativar para reconectar"; desativadas.
    - Linha de bloqueio com `id="push-blocker"`, ligada aos botões por `aria-describedby`.
    - Mostrar o último envio ("Último envio: enviado ao provedor em …", "falhou em …", "expirou sem envio", "aguardando o worker") e "Worker sem sinal recente" quando for o caso.
  - **Depois de "Testar":** `setTimeout` de 5 s e de 20 s para reconsultar `getPushConfiguration`, limpos no unmount.

- [x] **Step 4: Atualizar `docs/push.md`**

  - O contato pode ficar em `/config/orbit.env`.
  - Requisito de proxy: `X-Forwarded-Host` ausente ou igual ao host público.
  - Limite do Helium/ungoogled-chromium.
  - Roteiro Android: Chrome, HTTPS, ativar, testar, conferir o "Último envio".
  - Corrigir o comentário obsoleto sobre a migração em `docs/push.md:104` e `tests/push.test.ts:31-32`.

- [x] **Step 5: Rodar os testes e confirmar que passam**

  Run: `npx playwright test tests/e2e/push.spec.ts && npm run typecheck`

  Expected: PASS.

- [x] **Step 6: Deixar o diff pronto, sem commit**

### Task 5: Catálogo de temas v2 no banco

**Files:**
- Modify: `src/lib/taxonomy.ts`
- Modify: `src/db/taxonomy.ts`
- Modify: `src/db/index.ts:17-18`
- Create: `tests/taxonomy-catalog.test.ts`
- Modify: `tests/taxonomy.test.ts`

**Interfaces:**
- Produces, em `src/lib/taxonomy.ts`:
  ```ts
  export const LEGACY_TAXONOMY; // TAXONOMY atual, congelado; usado só pela v1
  export function legacyNormalizeTheme(theme: string): string | undefined;
  export function legacyNormalizeThemeWeights(weights: Record<string, number>): Record<string, number>;
  export const SEED_THEMES: readonly { id: string; label: string; description: string }[]; // 8 ids atuais
  export const SEED_IDS: readonly string[];
  export const MAX_THEMES = 40;
  export function themeKey(text: string): string;  // aliasKey + plural simples por palavra
  export function themeSlug(label: string): string; // ASCII a-z0-9 e "-", até 40 caracteres; "" se vazio
  export function validThemeLabel(label: string): boolean; // 1–4 palavras, só letras/espaço/hífen, 2–40 caracteres
  export type ThemeRow = { id: string; label: string; description: string; origin: "seed" | "ai"; aliases: string[]; createdAt: number };
  export function listThemes(db: OrbitDB): ThemeRow[]; // sementes primeiro, depois ai por created_at
  export function themeLabels(db: OrbitDB): Map<string, string>;
  export function resolveTheme(db: OrbitDB, labelOrId: string): string | undefined; // id, rótulo ou alias por themeKey
  ```
  - A descrição das sementes vem de `SEED_THEMES`; temas `ai` têm descrição `""`.
- Produces, em `src/db/taxonomy.ts`: `export function consolidateThemeCatalog(db): { version: 2; applied: boolean }`.

- [x] **Step 1: Escrever os testes que falham** (`tests/taxonomy-catalog.test.ts`, sobre `openDatabase(":memory:")`)
  - `"v2 aplica uma vez"`: o marcador `taxonomy_catalog_consolidations` tem `version = 2`. Uma segunda chamada a `consolidateThemeCatalog` retorna `applied: false`.
  - `"sementes"`:
    - `listThemes` tem 8 itens, todos com `origin = "seed"`.
    - O rótulo de `politica-interna` é "Política do Brasil".
    - `resolveTheme(db, "Política interna") === "politica-interna"`.
    - `resolveTheme(db, "Carros")` e `resolveTheme(db, "Automóveis")` são `undefined`.
    - `resolveTheme(db, "Animais") === "sociedade-cotidiano"`.
  - `"themeKey trata plural simples"`: são iguais `themeKey("Carros") === themeKey("carro")`, `themeKey("Automóveis") === themeKey("automovel")` e `themeKey("Animais") === themeKey("Animal")`.
  - `"guarda do catálogo"`:
    - Rejeitados: `INSERT` com `origin` padrão; `INSERT` com `origin = 'ai'` e id `"Carros"`; `UPDATE label` de semente; `DELETE` de semente.
    - Aceitos: `INSERT` válido com `origin = 'ai'`, id `"automotivo"` e rótulo `"Automotivo"`; `UPDATE aliases`; `DELETE` de tema `ai` sem itens.
    - Rejeitado: `DELETE` de tema `ai` com item referenciando.
  - `"rollback"`: injetar falha no meio, por exemplo um trigger `taxonomy_catalog_consolidations` que aborta. Esperado: sem tabelas v2 e com os triggers v1 restaurados.
  - `"v1 continua congelada"`: os testes de `tests/taxonomy.test.ts` passam com as funções `legacy*` renomeadas.
  - `"aliases das sementes não colidem entre temas"`: a v2 lança `"Alias duplicado entre temas"` se dois temas tiverem o mesmo `themeKey`. Testar a função de verificação com uma entrada sintética.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/taxonomy-catalog.test.ts tests/taxonomy.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar `themeKey`**

  É `aliasKey` seguido de, por palavra com mais de 3 letras, nesta ordem:

  | Final | Vira |
  |---|---|
  | `oes`, `aes` | `ao` |
  | `eis` | `el` |
  | `ais` | `al` |
  | `ns` | `m` |
  | `s` | (remove) |

- [x] **Step 4: Implementar `consolidateThemeCatalog`**

  Tudo em `client.transaction(...).immediate()`, com o marcador verificado primeiro:
  - Em `taxonomy_themes`: `ALTER TABLE` para `origin TEXT NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','ai'))`, `aliases TEXT NOT NULL DEFAULT '[]'` e `created_at INTEGER NOT NULL DEFAULT 0`.
  - Gravar os aliases de cada semente: `LEGACY_TAXONOMY` menos `Automóveis`, `Aluguel de carros`, `Coleção de carros`, `Oficina automotiva`, `Carros` e `Cars`, mais `Política interna` para `politica-interna`. Verificar colisão de `themeKey` entre temas.
  - `UPDATE label` de `politica-interna`.
  - `DROP TRIGGER taxonomy_catalog_insert/update/delete`.
  - Criar os triggers:
    - `taxonomy_theme_guard` (INSERT com `origin <> 'ai'`, id fora de `GLOB '[a-z0-9]*'` com caractere inválido, começando ou terminando em hífen, com mais de 40 caracteres, ou rótulo fora de 2–40 → `RAISE`);
    - `taxonomy_theme_immutable` (`BEFORE UPDATE OF id, label, origin`);
    - `taxonomy_theme_delete` (`WHEN OLD.origin = 'seed' OR EXISTS(processed_items.theme = OLD.id)`).
  - Criar `theme_proposals (raw_id TEXT PRIMARY KEY REFERENCES raw_items(id), label TEXT NOT NULL, label_key TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)` com índice em `label_key`.
  - Criar `taxonomy_reassignments (id INTEGER PRIMARY KEY AUTOINCREMENT, raw_id TEXT NOT NULL REFERENCES raw_items(id), from_theme TEXT NOT NULL, to_theme TEXT NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('proposal','legacy_label','merge')), at INTEGER NOT NULL)`.
  - Gravar o marcador.
  - Chamar a função em `openDatabase` logo após `consolidateTaxonomy(db)`.

- [x] **Step 5: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/taxonomy-catalog.test.ts tests/taxonomy.test.ts tests/migration.test.ts`

  Expected: PASS.

- [x] **Step 6: Deixar o diff pronto, sem commit**

### Task 6: Classificação com catálogo, propostas e recorrência

**Files:**
- Modify: `src/ai/classify.ts`
- Modify: `prompts/classify.md`
- Create: `src/lib/themes.ts`
- Test: `tests/ai.test.ts`, `tests/pipeline.test.ts`, `tests/theme-proposals.test.ts` (novo)

**Interfaces:**
- Consumes: Task 5.
- Produces, em `src/lib/themes.ts` (chamar só dentro de transação com lease):
  ```ts
  export type NewTheme = { label: string; aliases?: string[] };
  export function applyThemeProposal(db: OrbitDB, rawId: string, proposal: NewTheme): string | null; // id de tema existente se resolver; null se ficou em observação ou foi ignorada
  export function promoteProposals(db: OrbitDB, now?: number): string[]; // ids criados
  export function mergeTheme(db: OrbitDB, fromId: string, intoId: string): number; // itens movidos
  export function pendingProposalGroups(db: OrbitDB, limit?: number): { label: string; count: number }[]; // até 20, mais recentes
  ```
- Produces: `validateClassification(text, ids, themeIds: ReadonlySet<string>, lenient?: (theme: string) => string)`. O schema do item ganha `newTheme?: { label: string; aliases?: string[] }`, sem validar o rótulo no Zod.

- [x] **Step 1: Escrever os testes que falham** (`tests/theme-proposals.test.ts`, banco em memória com itens pessoais sintéticos)
  - `"três itens pessoais criam o tema e migram"`:
    - Fluxo: `applyThemeProposal` para 3 itens com `{ label: "Automotivo", aliases: ["Carros"] }`, `{ label: "Automotivo" }` e `{ label: "Carros", aliases: ["Automotivo"] }`, depois `promoteProposals`.
    - Esperado: cria um único tema com id `"automotivo"`, rótulo `"Automotivo"`, `origin = "ai"` e aliases contendo `"Carros"`; os três itens ficam com `theme = "automotivo"`; há três linhas `taxonomy_reassignments` com motivo `proposal`; `theme_proposals` fica vazia.
  - `"dois itens ficam em observação"`: `promoteProposals` retorna `[]`; `pendingProposalGroups` retorna `[{ label: "Automotivo", count: 2 }]`.
  - `"proposta resolve por rótulo existente e por alias de tema ai"`:
    - Depois de criado `automotivo` com o alias `Carros`, `applyThemeProposal(db, x, { label: "carro" })` retorna `"automotivo"` (rótulo igual a alias, com plural normalizado); com `{ label: "Carros elétricos", aliases: ["Carros"] }`, também retorna `"automotivo"` (alias igual a alias de tema `ai`).
    - `{ label: "Educação" }` retorna `"sociedade-cotidiano"`.
  - `"alias de semente não captura nem migra"`: com propostas `{ label: "Automotivo", aliases: ["Mobilidade"] }` ×3, o tema criado não tem `Mobilidade` entre os aliases, e itens legados com `original_theme = "Mobilidade"` continuam em `sociedade-cotidiano`.
  - `"rótulos legados migram"`: um item com auditoria v1 `original_theme = "Carros"`, `theme_id = "sociedade-cotidiano"` e `theme` atual igual vai para `automotivo` quando o tema é criado com o alias `Carros`, com motivo `legacy_label`. Um item cujo tema atual já mudou não é tocado.
  - `"notícias e spam não propõem"`: `applyThemeProposal` para item `news` ou `isSpam` retorna `null` sem gravar proposta.
  - `"rótulos inválidos são ignorados"`: `"Eleições 2026"`, `"日本料理"` (slug vazio) e um rótulo com 5 palavras não geram proposta.
  - `"teto de 40"`: com 40 temas, `promoteProposals` não cria; as propostas permanecem.
  - `"juntar temas"`:
    - `mergeTheme(db, "automotivo", "sociedade-cotidiano")` move os itens (motivo `merge`), apaga o tema e acrescenta `"Automotivo"` aos aliases do destino.
    - O peso fica com a média se ambos existirem, ou com o valor de origem se só ela existir; a chave de origem é removida.
    - `mergeTheme` com semente como origem lança `"Somente temas criados automaticamente podem ser juntados."`.

  Em `tests/pipeline.test.ts`:
  - `"lote com newTheme grava proposta e tema existente"`: o servidor local responde com `newTheme`; o item é salvo com o `theme` existente e há uma proposta.
  - `"segunda resposta inválida resolve tema desconhecido"`: duas respostas com `theme: "Ciência"` e depois `"inventado"`; o lote é salvo com `ciencia-saude`/`outros`, sem lançar. Ajustar o caso atual das linhas 63-67.
  - `"catálogo vai na mensagem de usuário"`: o payload do usuário contém `themes` com os 8 ids e `proposedThemes`; o prompt de sistema não contém `"Catálogo permitido"`.

  Em `tests/ai.test.ts`: passar `new Set(SEED_IDS)` como terceiro argumento. Os casos de rejeição das linhas 89-98 continuam. Acrescentar: `newTheme` com objeto extra é aceito e `aliases` é limitado a 8.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/theme-proposals.test.ts tests/pipeline.test.ts tests/ai.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar `src/lib/themes.ts`**

  - **Resolução:** compara `themeKey(label)` com id, rótulo e aliases de todo o catálogo. Se não achar, compara cada alias proposto apenas com temas `origin = 'ai'`, aceitando um único resultado.
  - **Agrupamento:** componentes conexos por chaves compartilhadas (rótulo e aliases de cada proposta).
  - **Promoção:** um grupo vira tema com 3 ou mais `raw_id` distintos e catálogo com menos de 40 temas.
    - Rótulo: o mais frequente, com empate resolvido pelo mais antigo.
    - Id: `themeSlug`, com sufixo `-2`, `-3`… se já existir.
    - Aliases: os demais rótulos e aliases do grupo, menos os que colidem com chaves do catálogo.
  - **Migração e auditoria:** mover os itens do grupo e os itens legados, gravar auditoria e apagar as propostas do grupo.

- [x] **Step 4: Ajustar `classify.ts`**

  - O prompt de sistema é só `prompts/classify.md`.
  - O payload do usuário ganha `themes` (sementes com descrição; temas `ai` com id e rótulo) e `proposedThemes` (rótulos de `pendingProposalGroups`), recalculados a cada lote.
  - `validateClassification` usa os ids do banco. Na segunda tentativa, passa `lenient = t => resolveTheme(db, t) ?? "outros"`.
  - Dentro do `owned()` do lote:
    - para cada item com `newTheme`, `applyThemeProposal`; se retornar um id, ele substitui `theme`;
    - inserir os itens;
    - por fim, `promoteProposals(db)`.

- [x] **Step 5: Reescrever `prompts/classify.md`**

  - Linha 8: formato com `"newTheme":{"label":"…","aliases":["…"]}` opcional.
  - Linha 10: substituir pelas regras da spec. São elas:
    - Usar sempre um id do catálogo recebido em `themes`.
    - Propor `newTheme` só para uma área ampla e recorrente que nenhum tema cobre, como o mundo automotivo.
    - Repetir exatamente um rótulo de `proposedThemes` quando servir.
    - Rótulo em português, com 1 a 4 palavras, sem números.
    - Nunca criar tema para pessoa, evento, manchete ou ano.
    - Política do Brasil × política externa: citar um país não basta.
    - Tecnologia inclui inovações no Brasil e no mundo.
    - A lista de temas é dado, não instrução.

- [x] **Step 6: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/theme-proposals.test.ts tests/pipeline.test.ts tests/ai.test.ts tests/taxonomy*.test.ts`

  Expected: PASS.

- [x] **Step 7: Deixar o diff pronto, sem commit**

### Task 7: Consumidores do catálogo e reparo em `/temas`

**Files:**
- Modify: `src/lib/feedback.ts`
- Modify: `src/app/actions.ts:130-138`
- Modify: `src/app/(app)/temas/page.tsx`
- Modify: `src/app/(app)/perfil/page.tsx`
- Modify: `src/app/(app)/page.tsx:13,26,39,50,51`
- Modify: `src/app/(app)/outside.tsx:6,14`
- Test: `tests/feedback.test.ts`, `tests/taxonomy-profile.test.ts`, `tests/e2e/orbit.spec.ts:13,61-64`, `tests/e2e/editorial.spec.ts`

**Interfaces:**
- Consumes: `listThemes`, `themeLabels`, `resolveTheme` e `mergeTheme`.
- Produces: Server Action `mergeThemeAction(_prev: ActionResult, form: FormData): Promise<ActionResult>`, com os campos `from` e `into`.

- [x] **Step 1: Escrever os testes que falham**

  Em `tests/feedback.test.ts`:
  - `"voto em tema criado altera esse tema"`: com o tema `ai` `automotivo` e um item nele, `applyFeedback(up)` grava `weights.automotivo = 3` e não grava `outros`.
  - `"updateTopicWeight aceita id criado"`: a chamada é aceita.
  - Tema desconhecido continua lançando `/catálogo|taxonomia/`.

  Em `tests/taxonomy-profile.test.ts`:
  - `"perfil lista tema criado"`: o formulário tem `name="theme"` com valor `automotivo`, e o rótulo aparece.

  Em `tests/e2e/orbit.spec.ts`:
  - Trocar `normalizeTheme` por ids diretos.
  - `"tema criado aparece em Temas e pode ser juntado"`: inserir via SQL um tema `ai` e um item; `/temas` mostra o tema com "Juntar a outro tema"; juntar com "Outros" remove o tema da lista.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/feedback.test.ts tests/taxonomy-profile.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar**

  - **`feedback.ts`:**
    - `storedWeights` faz `JSON.parse` com `themeWeightsSchema` e sem normalização estática.
    - `rankingExpression` sem normalização.
    - `applyFeedback` usa `item.theme`.
    - `updateTopicWeight` usa `resolveTheme(db, …)` e lança `"Escolha um tema do catálogo da taxonomia."`.
  - **`actions.ts`:**
    - `saveTopicWeight` distingue o erro de tema ("Tema não encontrado no catálogo.") do de perfil ausente.
    - Nova `mergeThemeAction` com `requireSession`, validação zod (`max(40)`), `mergeTheme` em transação IMMEDIATE e `refresh()`.
  - **`/temas`:**
    - Listar sementes; temas `ai` com contagem e "Criado automaticamente em DD/MM/AAAA"; e o formulário "Juntar a outro tema" (select com os demais temas e botão "Juntar").
    - Mostrar a seção "Em observação" com `pendingProposalGroups` ("Automotivo · 2 de 3 itens").
    - Com 40 temas, mostrar o aviso: "Limite de 40 temas atingido; junte temas para liberar espaço."
    - Trocar o subtítulo por: "Temas base do Orbit e temas criados automaticamente quando um assunto se repete nos seus conteúdos."
  - **`/perfil`:** usar `listThemes` e trocar a frase do catálogo por: "Temas base do Orbit e temas criados a partir do seu conteúdo."
  - **Home e `outside.tsx`:** carregar `themeLabels(db)` uma vez por render. O filtro aceita qualquer id do catálogo.
  - **E2E editorial:** `tests/e2e/editorial.spec.ts:37` continua esperando 8 seções de temas base. Usar um seletor só para as sementes, se o markup mudar.

- [x] **Step 4: Rodar os testes e confirmar que passam**

  Run: `npx vitest run tests/feedback.test.ts tests/taxonomy-profile.test.ts tests/session-guard.test.ts tests/outside.test.ts && npm run typecheck`

  Expected: PASS.

- [x] **Step 5: Deixar o diff pronto, sem commit**

### Task 8: Briefings sob demanda

**Files:**
- Modify: `src/db/schema.ts:65,108`
- Modify: `src/lib/store.ts`
- Modify: `src/lib/editions.ts`
- Modify: `src/ai/briefing.ts:26-68`
- Modify: `src/ai/edition.ts:27-50,75,100,124`
- Modify: `src/lib/run.ts`
- Modify: `src/worker.ts:62-71`
- Modify: `src/app/actions.ts`
- Modify: `src/app/components.tsx`
- Modify: `src/app/(app)/briefing.tsx`, `edition-spotlight.tsx`, `briefings/page.tsx`, `briefings/[id]/page.tsx`, `status/page.tsx:60`
- Modify: `prompts/edition.md`
- Test: `tests/store.test.ts`, `tests/editions.test.ts`, `tests/edition-generation.test.ts`, `tests/briefing.test.ts`, `tests/worker-briefing.test.ts` (novo)

**Interfaces:**
- Produces:
  ```ts
  // store.ts
  export function queueBriefingRefresh(db: OrbitDB, now?: number): "queued" | "active" | "recent";
  // editions.ts
  export function queueManualEdition(db: OrbitDB, now?: Date): "queued" | "active" | "recent" | "timezone";
  // briefing.ts
  export type BriefingOutcome = "created" | "unchanged" | "empty" | "no_profile";
  export async function generateBriefing(...): Promise<BriefingOutcome>;
  // actions.ts (Server Actions)
  export async function requestPersonalBriefing(): Promise<ActionResult>;
  export async function requestGeneralBriefing(): Promise<ActionResult>;
  // components.tsx
  export function PersonalBriefingButton(): JSX.Element; // "Atualizar briefing pessoal"
  export function GeneralBriefingButton(): JSX.Element;  // "Gerar briefing geral agora"
  ```
  - `schema.ts`: `collectorRuns.kind` aceita `"briefing"`; `editions.edition` aceita `"manual"`.

- [x] **Step 1: Escrever os testes que falham**

  Em `tests/store.test.ts`:
  - `queueBriefingRefresh`: retorna `queued`; com outra execução `briefing` em `queued`, `active`; após terminar, `recent` dentro de 5 min. Não interfere em `enqueueCollection` nem é afetado por ele.

  Em `tests/editions.test.ts`:
  - `queueManualEdition`: retorna `"timezone"` sem fuso confirmado; com `edition_schedule` salvo e fuso válido, `"queued"`, criando uma edição `manual` com slot `manual:America/Sao_Paulo:<ms>`, janela de 24 h e `collector_run` com `trigger = "manual"`. Com uma edição em `queued`, `"active"`; logo após uma manual, `"recent"`.

  Em `tests/edition-generation.test.ts`:
  - Edição manual sem candidatos novos: `unavailable`, aviso com "Nenhuma notícia datada nova" e zero chamadas de IA.
  - `scheduledAt` 3 h antes não vira "atraso".
  - Edição publicada não cria `push_deliveries`.
  - Exclui itens já publicados nas 24 h.
  - A tarde exclui itens de uma manual do mesmo dia.

  Em `tests/briefing.test.ts`:
  - Trocar `true`/`false` pelos retornos `created`/`unchanged`.
  - Acrescentar `empty` e `no_profile`, sem chamada de rede.
  - `"nada mudou não depende do dia UTC"`: com o mesmo conteúdo e `vi.setSystemTime` no dia seguinte, o retorno é `unchanged` (manter os itens com `fetchedAt` dentro da janela).

  Em `tests/worker-briefing.test.ts`:
  - Execução `kind = briefing` sem modelo de briefing: `error` e `briefing_notice` com o motivo, zero chamadas.
  - Com endpoint local: classifica as pendências e gera o briefing (`completed`).
  - Cache: `completed` com aviso "Nada mudou", sem nova reserva.
  - Perda de lease no meio: nada é gravado.
  - Exceção inesperada em uma edição com lease válido: a edição vira `error`.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/store.test.ts tests/editions.test.ts tests/edition-generation.test.ts tests/briefing.test.ts tests/worker-briefing.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar a fila e a execução**

  - **Proteções de `queueBriefingRefresh` e `queueManualEdition`:** usar uma transação IMMEDIATE, como em `enqueueCollection`. Rejeitar quando existir execução pai do mesmo tipo em `queued`/`running` ou execução manual do mesmo tipo iniciada há menos de 5 min.
  - **`runWithConfiguredAI`:** despacha `kind === "briefing"` para `runCollection` sem fontes, com `skipSources: true`, mantendo classificação e briefing. O retorno de `generateBriefing` vira `briefing_notice`:
    - `created`: vazio;
    - `unchanged`: "Nada mudou desde o último briefing; nenhuma chamada de IA foi feita.";
    - `empty`: "Nenhum item analisado nas últimas 24 horas. Atualize as fontes para coletar novidades.";
    - `no_profile`: "Configure seus interesses para gerar o briefing pessoal."
  - **Snapshot:** o hash do snapshot exclui `dayUTC`; o payload continua com ele.
  - **`edition.ts`:**
    - `edition === "manual"` ignora o limite de 2 h, não chama `queueEditionPush` e, sem candidatos, usa a mensagem própria.
    - `editionCandidates`:
      - a tarde exclui IDs e manchetes de edições `morning` e `manual` publicadas no mesmo dia local;
      - a manual exclui itens de qualquer edição publicada com `windowTo > windowFrom`;
      - o contexto da manhã continua só para a tarde.
  - **`worker.ts`:** no `catch` da execução, dentro da transação com `assertActive`, se `run.editionId` existir, atualizar a edição `running` para `error` com a mesma mensagem.

- [x] **Step 4: Implementar ações e interface**

  - **Ações:**
    - `requestPersonalBriefing` recusa sem interesses ("Configure seus interesses antes de atualizar o briefing pessoal.") ou com `briefingProblem`.
    - `requestGeneralBriefing` recusa com `briefingProblem` ou sem fuso ("Confirme o fuso das edições em Configurações antes de gerar um briefing geral.").
    - Ambas avisam o estado do worker via `workerOnline` e informam "Usa o orçamento diário de IA compartilhado."
  - **Botões:** `PersonalBriefingButton` e `GeneralBriefingButton` seguem o padrão de `CollectButton`, com os ícones `RefreshCw` e `Newspaper`.
  - **Card do briefing (`briefing.tsx`):**
    - Botão no cabeçalho dos dois ramos.
    - `briefing_notice` aparece também quando existe briefing.
    - Com execução `briefing` ativa: "Atualizando o briefing pessoal…" e `WorkRefresh`.
  - **Edições:**
    - `edition-spotlight.tsx` e `/briefings` ganham o botão geral.
    - `editionLabel("manual")` retorna "Edição sob demanda". Em `[id]/page.tsx` e no destaque, usar "Gerada em", sem a nota de atraso.
  - **Status:** `/status` mostra a origem "Briefing pessoal" para `kind = briefing`.
  - **Prompt:** em `prompts/edition.md`, acrescentar o parágrafo da edição manual.

- [x] **Step 5: Confirmar que não há migração**

  Run: `npx drizzle-kit generate`

  Expected: "No schema changes", sem arquivo novo em `drizzle/`. Se gerar arquivo, apagar e investigar.

- [x] **Step 6: Rodar os testes e confirmar que passam**

  Run: `npx vitest run && npm run typecheck`

  Expected: PASS.

- [x] **Step 7: Deixar o diff pronto, sem commit**

### Task 9: RSS no briefing pessoal

**Files:**
- Modify: `src/ai/briefing.ts`
- Modify: `prompts/briefing.md`
- Modify: `src/ai/classify.ts:27,33`
- Modify: `src/lib/feedback.ts:23-46`
- Modify: `src/lib/outside.ts:8-11`
- Modify: `src/app/(app)/briefing.tsx`
- Modify: `src/app/(app)/fontes/page.tsx:44`
- Test: `tests/briefing.test.ts`, `tests/outside.test.ts`, `tests/feedback.test.ts`, `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `BriefingOutcome` (Task 8), que ganha `"no_personal"`.
- Produces: `validateBriefing(text: string, ids: string[], optionalIds?: string[])` e o setting `briefing_external_notice`.

- [x] **Step 1: Escrever os testes que falham**

  Em `tests/briefing.test.ts`:
  - `"inclui até 3 RSS datados e marcados"`: fixtures com RSS de `newsPublishedAt` recente, analisados.
    - O payload contém os itens pessoais e até 3 externos, todos com `external: true`, descrição com até 1.500 caracteres e `publishedAt === newsPublishedAt`.
    - Fontes diferentes vêm primeiro, e manchetes duplicadas aparecem uma só vez.
  - `"exclui RSS sem data, antigo, spam ou não analisado"`: nenhum desses entra no payload.
  - `"sem item pessoal não há briefing"`: retorna `"no_personal"`, sem chamada de rede.
  - `"externo omitido é aceito, pessoal omitido é rejeitado"`: `validateBriefing` com `optionalIds`.
  - `"aviso quando não há externas"`:
    - nenhum RSS ativo → "Nenhum RSS externo ativo";
    - só itens sem data → "Nenhuma notícia RSS com data de publicação comprovada nas últimas 24 horas";
    - pendentes → "aguardando análise".
  - `"orçamento corta RSS antes do pessoal"`.

  Em `tests/feedback.test.ts`:
  - `"feedback em notícia não altera pesos"`: um `up`/`click` em item `news` grava a linha de feedback, mas `weights` não muda; o mesmo voto em item do YouTube altera.

  Em `tests/outside.test.ts`:
  - Fixture com `newsPublishedAt`.
  - `"publishedAt recente com newsPublishedAt antigo fica fora"`.
  - `"item citado no último briefing fica fora"`.

  Em `tests/pipeline.test.ts`:
  - `"notícias antigas ou sem data não são classificadas"`.
  - `"pendências mais recentes primeiro"`.
  - `"descrição de notícia limitada a 1.500"`.

- [x] **Step 2: Rodar e confirmar que falham**

  Run: `npx vitest run tests/briefing.test.ts tests/outside.test.ts tests/feedback.test.ts tests/pipeline.test.ts`

  Expected: FAIL.

- [x] **Step 3: Implementar**

  - **`briefing.ts`:**
    - A consulta de externos usa `platform = 'news'`, `evidence = 'news_rss'`, `activeItemCondition()`, `isSpam = false` e `newsPublishedAt` entre `from` e `now`. Ordena por `score desc, newsPublishedAt desc`, com limite de 30.
    - Em JS: deduplicar manchetes com `titleKey`, escolher primeiro uma por fonte e completar até 3.
    - A lista vai pessoais primeiro, depois externos.
    - Depois do laço de orçamento, exigir ao menos um pessoal.
    - O motivo da falta de externos é calculado na geração e gravado em `briefing_external_notice` dentro do `owned()` do chamador. Pode ser retornado junto ao resultado ou gravado por `generateBriefing`, que já recebe `assertActive`.
    - A falha de validação distingue as duas mensagens: "A IA retornou JSON inválido para o briefing duas vezes." e "A IA não citou corretamente as fontes do briefing duas vezes."
  - **`prompts/briefing.md`:** parágrafo novo da spec, seção D. A regra "Cada ID recebido…" passa a valer para itens sem `external`; itens `external: true` aparecem no máximo uma vez.
  - **`classify.ts`:**
    - Para notícias, `description` com `.slice(0, 1500)`.
    - A condição de candidatos exige `platform <> 'news' OR newsPublishedAt >= now - 48h`.
    - `orderBy(desc(rawItems.fetchedAt))`.
  - **`feedback.ts`:** consultar `rawItems.platform` e aplicar o delta só quando não for `news`.
  - **`outside.ts`:** recência por `gte(rawItems.newsPublishedAt, cutoff)` e `notInArray` com os IDs externos citados nos tópicos do último briefing.
  - **`briefing.tsx`:**
    - Aviso fixo quando houver externas.
    - Rótulo "Inclui fonte externa" no tópico.
    - Contagem "N itens pessoais · M notícias externas".
    - Sem externas, mostrar `briefing_external_notice`.
    - `no_personal` no ramo vazio orienta para `/briefings` e "Fora da bolha".
  - **`fontes/page.tsx:44`:** acrescentar "e como complemento do briefing pessoal".

- [x] **Step 4: Rodar os testes e confirmar que passam**

  Run: `npx vitest run && npm run typecheck`

  Expected: PASS.

- [x] **Step 5: Deixar o diff pronto, sem commit**

### Task 10: Documentação e verificação completa

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `.env.example`, `compose.yaml` (só comentários), `docs/deploy.md`, `docs/taxonomy.md`, `docs/briefings.md`, `docs/surface-orbit.md:7`, `docs/superpowers/specs/2026-10-28-editorial-editions-design.md` (nota de substituição)

- [x] **Step 1: Atualizar os documentos**

  - **`CLAUDE.md`:** registrar a autorização desta evolução, apontando para a spec e o plano. Atualizar:
    - a frase de `readAIEnvironment`;
    - `src/lib/taxonomy.ts`: catálogo aberto com sementes, recorrência de 3 e teto de 40;
    - a regra "Nenhum RSS externo entra no briefing pessoal" → até 3 externas marcadas;
    - `news`/`news_rss`;
    - `src/lib/push.ts`: o contato pode vir do arquivo.
  - **`docs/deploy.md`:**
    - `ORBIT_PUSH_SUBJECT` no YAML;
    - a tabela de variáveis com a coluna "Pode ir no orbit.env";
    - o requisito de `X-Forwarded-Host`;
    - backup antes da atualização e rollback só com restauração.
  - **`CHANGELOG.md`:** seção "Não publicado".

- [x] **Step 2: Rodar a verificação completa**

  Run: `npm test && npm run typecheck && npm run check && npm run build && npm run test:e2e`

  Expected: tudo passa. Registrar contagens e falhas reais, sem omitir nada.

- [x] **Step 3: Deixar o diff pronto, sem commit**
