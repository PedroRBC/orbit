# Notificações, configuração visível, briefings sob demanda, RSS no briefing e temas automáticos

## Autorização e limites

Aprovado pelo usuário em 28/10/2026, sobre a versão 0.2.2 publicada. Trabalho na worktree `orbit-briefings-push`, branch `worktree-orbit-briefings-push`, criada a partir da tag `v0.2.2`. A `main` ainda não contém a 0.2.2; o commit `d365f249` da `main` (Bun lockfile e senha mínima de 8) fica fora desta base e será integrado depois. Sem commit, push, publicação, merge ou alteração no TrueNAS sem pedido específico.

Esta especificação substitui duas regras anteriores, por decisão do usuário: "Nenhum RSS externo entra no briefing pessoal" e "taxonomia pequena controlada / oito IDs fixos". Continuam valendo: login em toda página e Server Action, IA somente no worker, fila durável com lease, orçamento diário em UTC, testes sem chave ou API paga, sem segredos na interface.

## Problemas relatados e causas confirmadas

1. **Notificações não ativam (Helium e Android).** Causas confirmadas no código:
   - `ORBIT_PUSH_SUBJECT` só é lido do ambiente do processo. O `/config/orbit.env` lê apenas `AI_*`, e o YAML de exemplo do TrueNAS em `docs/deploy.md` não inclui a variável. Sem contato, o servidor devolve `publicKey: null` e o botão fica desativado.
   - `pushConfiguration` valida o endpoint fora do `try`. Um endpoint fora da lista permitida derruba toda a configuração, e "Desativar" também falha.
   - Chamadas do navegador (`serviceWorker.ready`, `pushManager.subscribe`) e das Server Actions não têm prazo. Se uma não termina, os botões ficam desativados para sempre.
   - Todo erro de `subscribe()` vira a mesma mensagem genérica. O Helium é derivado do ungoogled-chromium e, em geral, não tem serviço de push; isso não tem conserto no Orbit, só explicação clara.
   - "Estado neste aparelho" mostra o estado do servidor, enquanto "Desativar" usa o estado do navegador.
   - Qualquer exceção em `drainPush` encerra o worker e, com ele, o contêiner.
2. **Não há como forçar briefings.** Só existe "Atualizar fontes". O briefing pessoal roda apenas no fim de uma coleta, e as edições gerais só nos horários 08h/16h.
3. **Configuração invisível.** O nome do modelo de briefing nunca aparece. Erros de configuração do briefing viram mensagens genéricas, às vezes culpando a variável errada. Não há indicação de onde cada valor veio. O briefing aparece como "configurado" mesmo sem `AI_MODEL`, sem o qual nada é classificado.
4. **Temas fixos.** Enum de oito IDs, prompt proibindo temas novos, triggers bloqueando o catálogo e aliases que mandam "Carros/Automóveis" para "Sociedade e cotidiano".
5. **RSS fora do briefing.** A consulta do briefing pessoal exclui `platform = 'news'` por SQL. Além disso, "Fora da bolha" usa data de coleta em vez da data de publicação comprovada. Cliques e votos em notícias RSS também alteram os pesos do perfil pessoal.

## A. Configuração reconhecida

### Leitura

Um único leitor (`readEnvironment`) é usado pelo site e pelo worker. Ele substitui a leitura atual de `src/lib/ai-environment.ts`, e `readAIEnvironment` continua existindo para os chamadores atuais.

- Arquivos: com `ORBIT_ENV_FILE` preenchido, lê só esse arquivo; com `ORBIT_ENV_FILE=""`, não lê arquivo (testes); sem `ORBIT_ENV_FILE`, lê `.env` e depois `.env.local` (o segundo vence).
- Chaves lidas do arquivo (decisão do usuário): `AI_*`, `ORBIT_PUSH_SUBJECT`, `COLLECTOR_CRON`, `COLLECTOR_TIMEZONE`, `COLLECTOR_MAX_RUNS_PER_DAY`, `COLLECTOR_MAX_ITEMS` e `SCHEDULER_ENABLED`.
- Continuam só no ambiente do contêiner: `ORBIT_ALLOWED_HOSTS` (proteção contra DNS rebinding), `PORT`, `ORBIT_HOST`, `ORBIT_DB_PATH`, `ORBIT_ENV_FILE`, `ORBIT_BACKUP_DIR` e `TZ`.
- Precedência:
  - `AI_*` segue a regra atual: se algum arquivo candidato existir, os `AI_*` do ambiente são ignorados.
  - As outras chaves do arquivo usam esta ordem: valor não vazio do arquivo, depois valor não vazio do ambiente, depois o padrão. Valor vazio conta como ausente, porque o Compose passa `ORBIT_PUSH_SUBJECT=""`.
- Arquivo ilegível ou diretório não lança exceção. Vira estado `ilegível`, e os `AI_*` ficam ausentes, sem voltar para os do ambiente. Isso preserva o comportamento atual de falhar fechado.
- Nunca escrever em `process.env`. A saída inclui o ambiente do processo (para os chamadores atuais) e as chaves do arquivo; a origem é informada só para as chaves conhecidas.
- O worker relê o arquivo a cada ciclo, então mudanças valem sem reiniciar. `queueScheduledRun` lê a configuração antes de abrir a transação IMMEDIATE.
- `SCHEDULER_ENABLED` aceita só `true` ou `false`. Valor inválido gera erro que cita a variável. `COLLECTOR_MAX_RUNS_PER_DAY` inválido gera erro próprio, que também cita a variável, sem culpar "horários/fuso".

### Diagnóstico

`aiStatus(db?)` mantém os campos atuais e acrescenta:

- Estado do arquivo (caminho configurado em `ORBIT_ENV_FILE` ou `.env/.env.local`; nunca um caminho absoluto da home).
- Endpoint (só protocolo e `host:porta`) e chave (`definida`/`ausente`, nunca valor, tamanho ou prefixo).
- Modelo de classificação e modelo de briefing, cada um com nome, origem, estado (`carregado`, `ausente`, `inválido` ou `incompleto`), motivo e último sucesso.
- Limites e contato de notificações (`definido`, `ausente` ou `inválido`, mais a origem; nunca o endereço, que é dado pessoal).
- Aviso quando `AI_*` do contêiner foram ignorados por causa do arquivo.

O estado `incompleto` do briefing cobre: falta `AI_BASE_URL` ou `AI_API_KEY`; falta `AI_MODEL` (sem classificação, não há itens para o briefing); preços próprios ausentes com teto em USD.

Mensagens de erro citam a variável (por exemplo, `AI_DAILY_TOKEN_LIMIT inválido: use inteiro positivo.`) e nunca repassam texto bruto do Zod ou do SDK. Um helper único, `briefingProblem`, fornece o motivo para `aiStatus`, `run.ts`, `edition.ts` e para o card do briefing.

O último sucesso vem das tabelas de saída, sem migração: `max(processed_items.processedAt)` por modelo, `max(briefings.createdAt)` e `max(editions.generatedAt)` publicadas por modelo de briefing. `ai_calls` não ganha coluna.

### Painel

O painel "Configuração reconhecida" fica em `/configuracoes#ia` e substitui o bloco de status. Mantém os exemplos e a nota de privacidade.

- Linhas: arquivo, protocolo, endpoint, chave, modelo de classificação, modelo de briefing, limites, contato de notificações e agenda. A agenda mostra se veio da interface, do arquivo, do ambiente ou do padrão. As edições gerais mostram se foram ativadas pela interface ou herdadas do fuso.
- O texto sobre recarga passa a ser verdadeiro: valores do arquivo valem na próxima leitura; valores do ambiente do contêiner exigem recriar o contêiner.
- `/status` mostra o modelo de classificação e o de briefing, com link para `#ia`.

## B. Notificações

Correções (sem mudar a lista de provedores; Edge/WNS continua fora):

1. `ORBIT_PUSH_SUBJECT` também é lido do arquivo (seção A), no site e no worker.
2. `pushConfiguration`: uma checagem de endpoint que não lança resulta em `subscribed: false` e mantém `publicKey`. `removePushSubscription` vira no-op para endpoint inválido, porque nenhuma linha guardada pode corresponder a ele.
3. `pushConfiguration` devolve também, sem endpoint nem chaves:
   - o estado do contato (`ok`, `ausente` ou `inválido`);
   - o último envio deste aparelho (tipo, status e horário) e se o worker está online (`workerOnline`).
4. `push-settings.tsx`:
   - Verificação de suporte por partes: contexto seguro, service worker, `PushManager`/`Notification` (com a dica do iOS).
   - Prazo de 30 s em `serviceWorker.ready`, `pushManager.subscribe`, `getRegistration`/`getSubscription` e nas Server Actions. Não há prazo em `Notification.requestPermission`. Ao estourar o prazo, os botões são liberados, a mensagem é mostrada e o estado é reconciliado.
   - Trava de execução para não chamar `subscribe` duas vezes.
   - Mensagens por `error.name`, em pt-BR:
     - `NotAllowedError`: permissão.
     - `AbortError`: o navegador não conseguiu registrar o serviço de push. Navegadores sem serviços do Google, como Helium e ungoogled-chromium, geralmente não recebem notificações; use Chrome, Firefox ou Safari, ou o celular.
     - `InvalidStateError`: chave diferente.
     - Outros casos: mensagem genérica com o nome do erro.
   - Inscrição local com chave VAPID diferente: remover no servidor (ignorando erro), cancelar localmente e inscrever de novo, sem pedir que o usuário desative e ative.
   - "Estado neste aparelho" combina navegador e servidor. "Inscrição local não reconhecida pelo servidor" orienta a clicar em Ativar.
   - Uma linha de bloqueio, ligada aos botões por `aria-describedby`, mostra o primeiro impedimento real.
   - Após "Testar", reconsultar o estado aos 5 s e aos 20 s para mostrar o resultado do envio.
5. `drainPush`: retorno antecipado, com leitura simples, quando não há entrega `queued`, antes de qualquer transação IMMEDIATE. Entregas canceladas ou expiradas na fronteira são gravadas como `cancelled`/`expired`, não como `failed`.
6. `worker.ts`: um erro em `drainPush` só encerra o worker se o lease foi perdido (`assertActive` lança). Nos outros casos, registra e continua.
7. Documentação:
   - `ORBIT_PUSH_SUBJECT` no YAML do TrueNAS e na tabela de variáveis.
   - O contato pode ficar no `orbit.env`.
   - Requisito de proxy: `X-Forwarded-Host` ausente ou igual ao host público.
   - Limite conhecido do Helium/ungoogled-chromium.
   - Roteiro de teste no Android.

## C. Briefings sob demanda

- **Briefing pessoal:** botão "Atualizar briefing pessoal" no card da Home.
  - Enfileira um `collector_runs` com `kind = 'briefing'` e `trigger = 'manual'`. Não coleta fontes, mas classifica pendências com as regras de orçamento existentes (decisão do construtor: os itens seriam classificados na próxima coleta de qualquer forma) e gera o briefing.
  - Recusa antes de enfileirar quando faltam interesses ou quando `briefingProblem` existe.
  - Proteções: rejeita com uma execução `briefing` em `queued`/`running` e com outra iniciada há menos de 5 min.
- **Briefing geral:** botão "Gerar briefing geral agora" no destaque "Brasil e mundo" e em `/briefings`.
  - Cria uma edição `edition = 'manual'`, com slot `manual:<fuso>:<ms>`, janela das últimas 24 h e `trigger = 'manual'`.
  - Recusa sem fuso confirmado, com `briefingProblem`, com uma edição em `queued`/`running` ou com outra edição manual criada há menos de 5 min.
  - Na edição manual:
    - Exclui IDs e manchetes já publicados em edições dos últimos 24 h.
    - Não aplica o limite de atraso de 2 h.
    - Não envia push (decisão do construtor: o próprio usuário pediu a geração).
    - Usa o rótulo "Edição sob demanda" e "gerada em". Sem candidatos novos, informa isso sem chamar a IA.
  - A tarde exclui também os itens de edições manuais do mesmo dia. A manhã continua sendo um panorama de 24 h.
- `kind` e `edition` são enums só no TypeScript (coluna TEXT, sem CHECK). Não há migração SQL; confirmar com `drizzle-kit generate` na worktree, que não deve gerar arquivo.
- **Retorno de `generateBriefing`:** passa a ser `"created" | "unchanged" | "empty" | "no_profile" | "no_personal"`. O retorno vira o aviso do card, que aparece também quando já existe briefing. O snapshot deixa de incluir o dia UTC, para que "Nada mudou" seja verdadeiro; o dia continua no payload.
- **Execução presa:** se uma execução de edição lançar com lease válido, o worker marca a edição como `error` em vez de deixá-la `running`.
- **Interface:** estado de andamento ("Atualizando…") com o `WorkRefresh` existente e rótulo "Briefing pessoal" em `/status`.

## D. RSS no briefing pessoal

- **Seleção:** até 8 itens pessoais (consulta atual) mais até 3 notícias RSS.
  - Critérios: `platform = 'news'`, `evidence = 'news_rss'`, fonte ativa, analisadas e sem spam, com `newsPublishedAt` nas últimas 24 h.
  - Ordem: nota, depois data. Deduplicar manchetes e preferir fontes diferentes.
  - Pesos pessoais não se aplicam ao RSS.
  - Sem item pessoal, não há briefing pessoal; o card orienta para `/briefings` e "Fora da bolha".
- **Payload:** cada notícia vai marcada com `external: true`, descrição limitada a 1.500 caracteres e `publishedAt = newsPublishedAt`. Pessoais entram antes no laço de orçamento; o RSS é cortado primeiro.
- **Validação:** os IDs pessoais aparecem exatamente uma vez. Os externos podem não aparecer, ou aparecer uma única vez, permitindo ao modelo omitir notícias irrelevantes ou de assuntos excluídos. Continua o limite de 8 tópicos. A mensagem de falha distingue JSON inválido de fontes que não conferem.
- **Prompt:** as externas são complemento secundário. Só se juntam a um tópico pessoal quando tratam do mesmo fato concreto, com cada fonte atribuída. Notícias relevantes sem par ficam num tópico próprio. Nunca chamá-las de "seu feed" ou "recomendação". Respeitar os assuntos excluídos do perfil.
- **Card do briefing:**
  - Quando houver externas, aviso fixo: "Inclui notícias externas de RSS como complemento; elas não vêm do seu algoritmo."
  - Tópicos com fonte externa recebem o rótulo "Inclui fonte externa".
  - A contagem separa itens pessoais e externos.
  - Sem externas, mostrar o motivo calculado na geração e guardado em `settings`, sem consulta de IA no render. Motivos possíveis: nenhum RSS ativo; nenhuma notícia com data comprovada nas últimas 24 h; notícias aguardando análise; o modelo não citou nenhuma.
- **Classificação:**
  - A descrição de notícias vai limitada a 1.500 caracteres.
  - Notícias só são classificadas com `newsPublishedAt` nas últimas 48 h (economia; itens antigos ou sem data nunca entram em briefing ou "Fora da bolha").
  - Pendências são ordenadas da mais recente para a mais antiga.
- **Feedback:** votos, cliques e "salvar" em notícias continuam registrados, mas não alteram pesos do perfil. Os pesos já contaminados ficam como estão; limpar exige outra autorização.
- **Fora da bolha:** recência por `newsPublishedAt` (corrige o defeito da 0.2.2) e exclusão das notícias já citadas no briefing pessoal mais recente, aplicada no SQL antes do limite.

## E. Temas automáticos

### Catálogo

O catálogo fica persistido em `taxonomy_themes` e mantém os 8 IDs atuais como sementes:

- `politica-interna` passa a se chamar **Política do Brasil**, com "Política interna" como alias.
- A descrição de `tecnologia` passa a cobrir inovações no Brasil e no mundo.
- `sociedade-cotidiano` perde automóveis.
- Rótulos e descrições das sementes vivem no código. O mapa usado pela consolidação v1 fica congelado como legado.

### Migração v2

A migração v2 (`consolidateThemeCatalog`) roda depois da v1 em `openDatabase`. É idempotente (marcador próprio, tabela nova com `CHECK (version = 2)`), roda em transação IMMEDIATE e desfaz tudo em caso de falha. Ela:

- Acrescenta a `taxonomy_themes` as colunas `origin` (`seed` ou `ai`), `aliases` (JSON) e `created_at`, e atualiza o rótulo da semente.
- Remove os triggers que bloqueiam o catálogo e cria novos:
  - Insert só com `origin = 'ai'` e id ASCII em slug.
  - Update de id, rótulo ou origem bloqueado (aliases podem mudar).
  - Delete permitido só para tema `ai` sem itens referenciando.
- Mantém os triggers de validação de `processed_items.theme` e de pesos.
- Cria `theme_proposals` (`raw_id` PK, `label`, `label_key`, `aliases`, `created_at`) e `taxonomy_reassignments` (auditoria de itens movidos: de, para, motivo `proposal`, `legacy_label` ou `merge`, e horário).

### Classificação

Cada item recebe:

- `theme`: id existente. Ids vêm do banco, então temas criados passam a valer.
- Opcionalmente, `newTheme: { label, aliases? }`, quando nenhum tema existente cobre uma área ampla e recorrente.

O catálogo vai na mensagem de usuário, como dado, e não no prompt de sistema:

- Sementes com descrição.
- Temas criados só com id e rótulo.
- Rótulos de propostas em observação, para que o modelo repita o mesmo rótulo.

O prompt traz as orientações do usuário como exemplos, não como lista fechada:

- Política do Brasil × política externa.
- Tecnologia ampla, com inovações do mundo.
- Área recorrente, como o mundo automotivo, vira tema próprio.
- Nunca um tema por pessoa, evento, manchete ou ano.
- Rótulos em português, de 1 a 4 palavras.

### Regra de recorrência (decisão do usuário)

- Só itens pessoais propõem; propostas vindas de notícias são ignoradas.
- O servidor normaliza o rótulo (acentos, caixa, pontuação, plural simples) e compara com rótulos e aliases do catálogo:
  - Se encontrar um tema, usa esse tema.
  - Se não, grava a proposta e agrupa com propostas cujo rótulo ou alias normalizado coincida.
- Quando um grupo atinge **3 itens pessoais distintos**, e o catálogo tem menos de 40 temas, o tema é criado com `origin = 'ai'`:
  - Id em slug ASCII.
  - Rótulo mais frequente.
  - Aliases reunidos das propostas.
- Os itens do grupo migram para o novo tema, com auditoria, e as propostas são removidas.
- Rótulos legados guardados em `taxonomy_item_audit.original_theme` que coincidam com o rótulo ou aliases do novo tema também migram, desde que o item ainda esteja no tema mapeado pela v1. É o reaproveitamento dos rótulos originais aprovado no plano, sem chamada paga.
- Pesos não são remapeados.
- Rótulos inválidos (dígitos, mais de 4 palavras, slug vazio) não viram proposta e não derrubam o lote.
- Tudo acontece na mesma transação `owned()` que grava o lote.
- Na segunda resposta inválida de um lote, um `theme` desconhecido é resolvido por rótulo ou alias, ou vira `outros`, em vez de travar a fila.

### Reparo

Em `/temas`, cada tema criado tem a ação "Juntar a outro tema" (com "Outros", funciona como remoção). Ela:

- move os itens, com auditoria;
- combina os pesos pela média, como na v1;
- acrescenta o rótulo e os aliases ao destino;
- apaga o tema de origem.

Tudo em uma Server Action com `requireSession`.

### Interface

- `/temas` lista o catálogo do banco: sementes, temas criados (com data e contagem) e "Em observação" (rótulo e N de 3 itens).
- `/perfil` e o filtro da Home usam o catálogo do banco, e rótulos vêm de um mapa carregado por render.
- O texto "sem um tema novo a cada notícia" é atualizado.

### Feedback

- O peso vai para o tema do item, sem normalização estática.
- `updateTopicWeight` aceita qualquer id do catálogo.
- O erro de tema desconhecido tem mensagem própria.

### Rollback

Voltar para a imagem 0.2.2 depois da v2 exige restaurar o backup feito antes da atualização. Isso fica documentado em `docs/deploy.md`.

## Decisões do construtor (após revisão do documento)

- **Orçamento:** ações manuais usam o mesmo orçamento diário UTC, as mesmas reservas e o mesmo limite de 5 min. Não há cota separada. Os textos dos botões avisam que usam o orçamento diário compartilhado. Reservas ambíguas continuam sem liberação automática.
- **Perfil em lotes mistos de classificação:** fica como está. A nota das notícias continua orientada pelo prompt como importância geral. A escolha final das notícias para o briefing pessoal fica com o modelo de briefing, que recebe o perfil e pode omiti-las.
- **Aliases propostos:** aliases que coincidirem, após normalização, com rótulo ou alias de um tema existente são descartados, e o tema existente os mantém. Esses aliases também não participam do reaproveitamento legado.
- **Propostas:** contagem sem janela de tempo e sem expiração. Itens marcados como spam e notícias não propõem. Com 40 temas, as propostas continuam registradas, mas nada é criado; `/temas` informa o limite e sugere juntar temas. O payload leva no máximo os 20 grupos em observação mais recentes.
- **Reaproveitamento legado:** coincidência exata após normalização, nunca por inclusão de termos. Vale para qualquer item (pessoal ou notícia) que ainda esteja no tema atribuído pela v1.
- **Ordem da classificação:** todas as pendências são ordenadas por `fetchedAt` decrescente. "Fora da bolha" mantém a janela de 48 h, agora por `newsPublishedAt`.

## Não objetivos

- Edge/WNS e novos provedores de push.
- Mudar a ativação herdada das edições gerais: ela só passa a ser exibida.
- Remapear pesos aprendidos.
- Limpar pesos contaminados por RSS.
- Botão de teste de conexão de IA (gastaria tokens).
- Mudar a versão ou publicar imagem.

## Validação

- Testes Vitest sintéticos para cada seção, incluindo: leitura e precedência de arquivo, endpoint fora da lista, prazos, `drainPush` ocioso, filas manuais e suas proteções, seleção e validação de RSS, peso de feedback, migração v2 (aplicação, idempotência, rollback e triggers) e a regra de recorrência com reaproveitamento de rótulos legados e junção de temas.
- Rodar `npm test`, `npm run typecheck`, `npm run check`, `npm run build` e `npm run test:e2e`.
- E2E com stub de `PushManager.subscribe` que nunca termina: o botão volta a ficar disponível com a mensagem de prazo.
- O teste físico no Android e no NAS fica com o usuário, com roteiro em `docs/push.md`.
