# Orbit

## Escopo e decisões

Leia `PROJETO.md`. Entregas por fase; não avançar sem OK do usuário. Fases 1–4 autorizadas: YouTube RSS/home, X, Instagram, Valete+, ranking, briefing, tópicos, feedback e Meu perfil. Fase 5 autorizada: RSS externos/Fora da bolha, agenda, painel de custos e documentação final. Entrega aguarda teste final do usuário.

Aprovado em 28/10/2026: Orbit é um serviço próprio pensado para Docker (TrueNAS), sempre com login (senha + TOTP), sem "modo servidor" nem caminhos paralelos. Domínio, proxy e Tailscale ficam com o usuário; entregar contêiner, porta publicada e requisitos documentados. A extensão conversa com o servidor pela API. Fases: F1 contêiner, F2 login + companion, F3 PWA, F4 CI/GHCR; plano em docs/superpowers/plans/2026-10-28-docker-self-hosted.md. GitHub e GHCR privados; merge, publicação e alterações no TrueNAS real exigem aprovação específica.

Alteração aprovada em 27/10/2026: o endpoint de IA aceita protocolo OpenAI Compatible ou Anthropic Compatible, URL base, chave e modelo configuráveis. Não obrigar Anthropic nem mudar de fornecedor/modelo automaticamente. Canais e interesses são cadastrados na interface, sem dados presumidos.

Evolução autorizada em 28/10/2026: apresentação editorial, taxonomia pequena controlada, briefings gerais 08h/16h e Web Push. Implementar/testar/documentar em worktree, preservando alterações locais. Especificação em docs/superpowers/specs/2026-10-28-editorial-editions-design.md; plano em docs/superpowers/plans/2026-10-28-editorial-editions.md. O usuário autorizou depois commit, push e lançamento da versão 0.2.1 no destino privado existente. Publicar pela tag v0.2.1, sem merge na main nem alterações no TrueNAS sem autorização adicional. Conferir a CI antes de afirmar imagem disponível; latest continua reservado à main.

## Comandos

- Node.js >=22.12. `npm install` instala dependências.
- `npm run dev`: compila extensão, migra SQLite e inicia Next e worker. Localhost por padrão.
- `npm run auth -- setup|logout-all|unlock|status`: senha + TOTP + códigos de recuperação (terminal, sem log). No Docker: `docker exec -it <contêiner> npm run auth -- setup`.
- `npm run db:backup [dir]`: backup online verificado (arquivo único, sem -wal).
- Docker: `docker compose up -d --build` (volumes nomeados); guia TrueNAS em docs/deploy.md.
- CI (`.github/workflows/ci.yml`): testes, typecheck, build e e2e em PR/push; imagem privada `ghcr.io/pedrorbc/orbit` só em push na main (`<versão>`, `sha-<curto>`, `latest`) ou tag `v*` (semver + `sha-`). Antes de publicar exige repositório/pacote privados; depois confirma visibility, tags e digest pela API e pelo registry. Empurrar tag = publicar: exige confirmação do usuário. Destino privado e publicação de candidatos para teste foram confirmados nesta entrega; nunca publicar em outro destino nem mudar a visibilidade.
- Entrega Docker: [PR #2](https://github.com/PedroRBC/orbit/pull/2), [pacote privado](https://github.com/users/PedroRBC/packages/container/package/orbit). O usuário autorizou integrar na main e publicar a versão oficial `0.2.0` com `latest` e `sha-<curto>`. Padrão atualizado do Compose/guia: `ghcr.io/pedrorbc/orbit:0.2.1` (lançamento por tag autorizado); `latest` acompanha somente cada publicação da main. O workflow usa `flavor: latest=false` para evitar promoção automática de tag semver. Evidências anteriores do candidato rc.2 em docs/validation-self-hosted.md; não usar seu digest como se fosse o da versão oficial. Não afirmar teste no NAS/celular sem o usuário testar.
- `npm run build` e `npm start`: produção local com worker no mesmo comando.
- `npm test`: Vitest, SQLite em memória e endpoints HTTP locais, sem API paga.
- `npm run test:e2e`: Chromium, app/worker reais e banco isolado em test-results.
- `npm run typecheck`, `npm run check`.
- `npm run db:generate`, `npm run db:migrate`.

## Arquitetura

- `src/app`: Server Components consultam o banco; Server Actions validam formulários e enfileiram. Nunca chamar IA na renderização. Páginas protegidas ficam em `src/app/(app)/` (layout chama `requireSession()`); `/login` fica fora do grupo.
- Login: `src/lib/auth.ts` (scrypt, TOTP RFC 6238 ±1 passo sem replay, recuperação de uso único, sessões com hash, limite de 5 erros/15 min só por cliente = último salto do X-Forwarded-For; sem bloqueio global, que permitiria trancar o dono); `src/lib/session.ts`. Cookie `__Host-orbit_session` HttpOnly/Secure/SameSite=Strict, 30 dias. Login só por HTTPS (X-Forwarded-Proto) ou loopback. Toda Server Action exportada, página e rota de `(app)` começa com `await requireSession()` (teste session-guard): layout NÃO protege a renderização da página/RSC. O proxy também valida a sessão no banco.
- PWA: `src/app/manifest.ts`, ícones de `scripts/pwa-icons.ts`, `public/sw.js` guarda só `/offline.html` (só navegações GET; nunca dados, sessões ou POST). `src/app/connection.tsx` registra o SW e avisa desconexão consultando `/api/health`; não usar `experimental.useOffline` (reenvia Server Actions). Manifest, ícones, SW e offline são públicos no proxy. Alvos de toque ≥ 24 px verificados no e2e.
- `src/lib/hosts.ts` + `src/proxy.ts`: Host local ou listado em ORBIT_ALLOWED_HOSTS (senão 403); Origin/Sec-Fetch-Site mantidos; públicos só `/login`, `/api/health`, `/api/companion/*`. Redirect usa o Host validado, nunca request.url.
- Docker: Dockerfile multi-stage, usuário 568, raiz somente leitura, `/data` (SQLite), `/config/orbit.env` (só AI_*), `/backups`; HEALTHCHECK em `/api/health` (heartbeat do worker). `scripts/dev.ts --production` supervisiona Next e worker; erro claro se /data não for gravável.
- `src/db`: schema Drizzle e conexão SQLite WAL; migrações em `drizzle/`.
- `src/collectors/types.ts`: contrato `Collector.collect(): Promise<RawItem[]>`. Registry seleciona RSS/home/X por `sources.kind`.
- `src/collectors/youtube.ts`: RSS oficial. `readers.ts` contém leitores compartilhados browser-safe; `browser.ts` mantém a política de rede. `registry.ts` encaminha feeds pessoais à extensão, nunca abre Playwright para login.
- `browser-extension/`: MV3 no Helium, sem cookies/debugger/tabs/webRequest. O bundle é gerado em dist por build:extension e automaticamente em dev/build; `/conectar/extensao` entrega o ZIP (só com sessão). Conteúdo roda em mundo isolado; MAIN lê somente metadados/bootstrap do YouTube. Permissão do endereço do Orbit é `optional_host_permissions` pedida no clique do popup e removida ao desconectar.
- Teste assistido com T3 Default leu recomendações YouTube, legendas Instagram e posts Valete reais. Não implica que o worker herde cookies do T3. Nenhum cookie foi exportado; registros locais indicam captura assistida. X pediu login no T3.
- YouTube possui fallback de metadados de window.ytInitialData (sem tokens); Instagram reconhece a legenda associada ao mesmo autor e evita usar avatar como mídia.
- O servidor nunca abre navegador nem faz login nas plataformas: /fontes e o popup têm links normais para o usuário entrar no próprio navegador.
- Companion `/api/companion/(pair|poll|result|disconnect)` no mesmo endereço da interface (ponte loopback e PORT+1 foram removidas). Exige HTTPS via proxy ou HTTP em loopback (`requestOrigin`); extension-http.ts valida Origin chrome-extension://ID, token Bearer (hash no banco) e código único de 10 minutos gerado só com sessão. `/api/extension/*` é sempre recusado. Não relaxar CSRF das demais rotas. Jobs em companion_jobs são limitados e vinculados ao lease/run; nunca aceitar URLs/plataformas arbitrárias ou credenciais no payload.
- Após alterar código da extensão, subir a versão do manifest, recompilar e pedir que o usuário baixe o ZIP de novo e clique em Recarregar no Helium. Versão reportada via header permite detectar bundle antigo; não revogar pareamento à toa.
- Extensão abre abas próprias e instala regras DNR só nelas. IDs ficam em storage.session, nunca storage.local; não fechar abas preexistentes ou tocadas pelo usuário. Navegador aberto é requisito.
- Alarmes da extensão verificam pedidos locais a cada 30s; não são o agendamento de coletas da fase 5. Nenhuma fase nova foi autorizada pela melhoria de login.
- Valete usa GET /api/post?filter=all, primeira página, sessão do app e HTML convertido em texto inerte. Timeout/5xx/rede podem usar posts já visíveis no DOM, guardados com evidência valete_dom; login/403/verificação/429 nunca permitem fallback. Ao deduplicar IDs diferentes com mesmo permalink, vincular source_items ao raw_id existente, não ao ID ignorado no insert. Permalinks vêm do DOM, sem fabricar slugs. Instagram só lê legendas por seletores explícitos, nunca texto geral de comentários.
- 429 lança CollectorError rate_limited e persiste sources.cooldownUntil; o worker respeita Retry-After antes de executar a fonte.
- `source_items`: vínculo muitos-para-muitos; sempre gravar todo vínculo ao deduplicar e usar `activeItemCondition()` nas consultas. `raw_items.sourceId` mantém a primeira origem; o campo legado sources.channelId guarda o ID RSS ou a URL canônica do feed para fontes de navegador.
- `src/lib/store.ts`: fila durável, deduplicação, orçamento e lease do worker.
- `src/lib/public-feed.ts` e `collectors/news.ts`: RSS HTTPS público, DNS checado e IP pinado, TLS/SNI original, redirects revalidados, limites de corpo/tempo. Nunca trocar por fetch após checar DNS: introduziria rebinding.
- `src/lib/scheduler.ts`: node-cron só enfileira coletas sob lease; cron/fuso configuráveis, 3 horários/dia por padrão, max6 coletas automáticas/24h, dedupe de DST e sem sobreposição. Edições gerais têm agenda/cota separadas.
- `src/lib/taxonomy.ts` define oito IDs fixos; classificação aceita apenas `themeSchema`. `src/db/taxonomy.ts` consolida rótulos/pesos em transação IMMEDIATE depois das migrations do openDatabase, com auditorias, triggers e marcador idempotente. Pesos legados convergem pela média, nunca soma; desconhecidos ficam em Outros auditado. `topics` continua sendo agrupamento de briefing, não taxonomia. Labels sempre via `themeLabel()`. Ajustes manuais aceitam frações -20..20.
- `src/lib/editions.ts` e `src/ai/edition.ts`: edições gerais 08h/16h, `collector_runs.kind=edition` e `editions` persistidos. Fuso explícito herdado ou salvo; sem configuração propõe America/Sao_Paulo e não ativa. Somente RSS públicos com newsPublishedAt comprovado na janela; nunca usar updated/isoDate sintético do Atom como publicação. Legacy publishedAt é preservado e não prova recência; nova coleta preenche newsPublishedAt ainda nulo com pubDate/published original. Tarde exclui IDs/manchetes da manhã. Recuperação máxima de duas horas e duas tentativas persistidas, sem backlog. `/briefings` e `/briefings/[id]` exigem sessão. Nenhum RSS externo entra no briefing pessoal.
- `src/lib/push.ts`: VAPID em settings, contato ORBIT_PUSH_SUBJECT no ambiente dos processos (não no orbit.env AI-only). Inscrições protegidas, até dez aparelhos, endpoints conhecidos HTTPS com DNS público/IP pinado e TLS original. Outbox e edição publicadas na mesma transação. Worker envia sequencialmente sob lease, claim antes da rede e sem retry ambíguo; 404/410 remove inscrição. SW valida destino local e continua cacheando só offline.html. Ações autenticadas em src/app/push-actions.ts; adesão por clique. Veja docs/push.md.
- `news`/`news_rss` são exclusivamente fontes externas. Excluir do SQL do briefing pessoal/recomendações. `outside.ts` seleciona até3 itens com diversidade; fallback sem IA mostra manchete original, não nota inventada.
- `src/lib/run.ts`, `src/worker.ts`: execução sequencial, falhas isoladas, heartbeat e recuperação. Verificar lease dentro das transações de escrita e na fronteira de rede; perda de propriedade cancela a execução sem finalizar o job de outro worker.
- `src/ai`: SDKs oficiais dos dois protocolos; `request.ts` compartilha reservas/consumo. `classify.ts` cacheia itens; `briefing.ts` valida IDs, agrupa e cacheia por snapshot. `AI_BRIEFING_MODEL` é explícito e tem preços próprios.
- `src/lib/feedback.ts`: feedback transacional e pesos por tema. Pesos afetam ranking SQL e futuros prompts; cliques repetidos não acumulam pontos.
- `src/app/perfil`: interesses e pesos editáveis. Reações não executam ações sociais em plataformas.
- `prompts/`: instruções editáveis. Dados do feed não são instruções.
- `scripts/dev.ts`: supervisão de ambos os processos e encerramento do grupo.

## Convenções e segurança

TypeScript strict. Português do Brasil na interface. Nenhum segredo em client components ou mensagens de erro. `.env`, SQLite e perfis locais nunca entram no Git nem na imagem (.dockerignore). Testes usam ORBIT_DB_PATH=:memory: (vitest) ou bancos em test-results; e2e injeta sessão sintética pelo fixture `tests/e2e/fixtures.ts`. Não rodar trabalho em andamento na pasta onde o usuário mantém `next dev` aberto: usar worktree separada. Sem commits/push sem pedido.

`readAIEnvironment()` relê somente AI_* de .env/.env.local (no Docker, ORBIT_ENV_FILE=/config/orbit.env) sem alterar process.env/autenticação do agente. Arquivos locais prevalecem; testes sempre ORBIT_ENV_FILE="" para não consumir chave real. HTTP privado continua bloqueado; usuário escolheu manter HTTPS. Diagnósticos não devem mostrar valores de chave.

O usuário configura `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` no .env; não ler/exibir a chave em chat ou logs. HTTP só para endpoint loopback. Não seguir redirects com credenciais. Filtrar cabeçalhos dos SDKs na fronteira de fetch: OPENAI_CUSTOM_HEADERS/ANTHROPIC_CUSTOM_HEADERS não podem herdar autenticação do agente. Timeout de 45s abrange headers e corpo. Não usar autenticação herdada do agente para chamar APIs do app.

Orçamento diário usa UTC. Sem usage, reserva conservadora permanece. Sem preços explícitos, custo desconhecido (não zero). Não liberar reservas ambíguas automaticamente. Cache é por item concluído, sem reclassificação quando o perfil muda.

Sem download/proxy de mídia: thumbnail remota é carregada pelo navegador. Resumo de RSS não é resumo do vídeo completo; indicar título/descrição e duração desconhecida. Testes usam fixtures sintéticas identificadas apenas nos testes; nunca seed de notícias fictícias em produção.

UI segue `PRODUCT.md`, `docs/surface-orbit.md` e `DESIGN.md`. Não adicionar controles sem comportamento nem métricas inventadas. Usar o fluxo `/browse` para trabalho de navegador solicitado; e2e pode usar Playwright CLI.
