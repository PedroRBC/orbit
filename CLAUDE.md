# Orbit

## Escopo e decisões

Leia `PROJETO.md`. Entregas por fase; não avançar sem OK do usuário. Fases 1–4 autorizadas: YouTube RSS/home, X, Instagram, Valete+, ranking, briefing, tópicos, feedback e Meu perfil. Fase 5 autorizada: RSS externos/Fora da bolha, agenda, painel de custos e documentação final. Entrega aguarda teste final do usuário.

Alteração aprovada em 27/10/2026: o endpoint de IA aceita protocolo OpenAI Compatible ou Anthropic Compatible, URL base, chave e modelo configuráveis. Não obrigar Anthropic nem mudar de fornecedor/modelo automaticamente. Canais e interesses são cadastrados na interface, sem dados presumidos.

## Comandos

- Node.js >=22.12. `npm install` instala dependências.
- `npm run dev`: compila extensão, migra SQLite e inicia Next, worker e ponte loopback. Localhost por padrão.
- `npm run build` e `npm start`: produção local com worker no mesmo comando.
- `npm test`: Vitest, SQLite em memória e endpoints HTTP locais, sem API paga.
- `npm run test:e2e`: Chromium, app/worker reais e banco isolado em test-results.
- `npm run typecheck`, `npm run check`.
- `npm run db:generate`, `npm run db:migrate`.

## Arquitetura

- `src/app`: Server Components consultam o banco; Server Actions validam formulários e enfileiram. Nunca chamar IA na renderização.
- `src/db`: schema Drizzle e conexão SQLite WAL; migrações em `drizzle/`.
- `src/collectors/types.ts`: contrato `Collector.collect(): Promise<RawItem[]>`. Registry seleciona RSS/home/X por `sources.kind`.
- `src/collectors/youtube.ts`: RSS oficial. `readers.ts` contém leitores compartilhados browser-safe; `browser.ts` mantém a política de rede. `registry.ts` encaminha feeds pessoais à extensão, nunca abre Playwright para login.
- `browser-extension/`: MV3 no Helium, sem cookies/debugger/tabs/webRequest. O bundle é gerado em dist por build:extension e automaticamente em dev/build. Conteúdo roda em mundo isolado; MAIN lê somente metadados/bootstrap do YouTube.
- Teste assistido com T3 Default leu recomendações YouTube, legendas Instagram e posts Valete reais. Não implica que o worker herde cookies do T3. Nenhum cookie foi exportado; registros locais indicam captura assistida. X pediu login no T3.
- YouTube possui fallback de metadados de window.ytInitialData (sem tokens); Instagram reconhece a legenda associada ao mesmo autor e evita usar avatar como mídia.
- `npm run login -- youtube|x|instagram|valete`: abre o navegador HTTPS normal via GIO (Linux), sem flags/perfil de automação. O usuário instala a extensão no próprio perfil e pareia em /conectar.
- Ponte /api/extension: listener dedicado src/extension-server.ts em 127.0.0.1, PORT+1 ou ORBIT_EXTENSION_PORT. A interface Next SEMPRE recusa esse caminho, para impedir Host spoof na LAN. extension-http.ts valida origem/token/código único de 10 minutos e hash no banco. Não relaxar CSRF das demais rotas. Jobs em companion_jobs são limitados e vinculados ao lease/run; nunca aceitar URLs/plataformas arbitrárias ou credenciais no payload.
- Após alterar código da extensão, recompilar bundle e pedir Recarregar no Helium. Versão reportada via header permite detectar bundle antigo; não revogar pareamento à toa.
- Extensão abre abas próprias e instala regras DNR só nelas. IDs ficam em storage.session, nunca storage.local; não fechar abas preexistentes ou tocadas pelo usuário. Navegador aberto é requisito.
- Alarmes da extensão verificam pedidos locais a cada 30s; não são o agendamento de coletas da fase 5. Nenhuma fase nova foi autorizada pela melhoria de login.
- Valete usa GET /api/post?filter=all, primeira página, sessão do app e HTML convertido em texto inerte. Timeout/5xx/rede podem usar posts já visíveis no DOM, guardados com evidência valete_dom; login/403/verificação/429 nunca permitem fallback. Ao deduplicar IDs diferentes com mesmo permalink, vincular source_items ao raw_id existente, não ao ID ignorado no insert. Permalinks vêm do DOM, sem fabricar slugs. Instagram só lê legendas por seletores explícitos, nunca texto geral de comentários.
- 429 lança CollectorError rate_limited e persiste sources.cooldownUntil; o worker respeita Retry-After antes de executar a fonte.
- `source_items`: vínculo muitos-para-muitos; sempre gravar todo vínculo ao deduplicar e usar `activeItemCondition()` nas consultas. `raw_items.sourceId` mantém a primeira origem; o campo legado sources.channelId guarda o ID RSS ou a URL canônica do feed para fontes de navegador.
- `src/lib/store.ts`: fila durável, deduplicação, orçamento e lease do worker.
- `src/lib/public-feed.ts` e `collectors/news.ts`: RSS HTTPS público, DNS checado e IP pinado, TLS/SNI original, redirects revalidados, limites de corpo/tempo. Nunca trocar por fetch após checar DNS: introduziria rebinding.
- `src/lib/scheduler.ts`: node-cron só enfileira sob lease; cron/fuso configuráveis, 3 horários/dia por padrão, max6 automáticas/24h, dedupe de DST e sem sobreposição.
- `news`/`news_rss` são exclusivamente fontes externas. Excluir do SQL do briefing pessoal/recomendações. `outside.ts` seleciona até3 itens com diversidade; fallback sem IA mostra manchete original, não nota inventada.
- `src/lib/run.ts`, `src/worker.ts`: execução sequencial, falhas isoladas, heartbeat e recuperação. Verificar lease dentro das transações de escrita e na fronteira de rede; perda de propriedade cancela a execução sem finalizar o job de outro worker.
- `src/ai`: SDKs oficiais dos dois protocolos; `request.ts` compartilha reservas/consumo. `classify.ts` cacheia itens; `briefing.ts` valida IDs, agrupa e cacheia por snapshot. `AI_BRIEFING_MODEL` é explícito e tem preços próprios.
- `src/lib/feedback.ts`: feedback transacional e pesos por tema. Pesos afetam ranking SQL e futuros prompts; cliques repetidos não acumulam pontos.
- `src/app/perfil`: interesses e pesos editáveis. Reações não executam ações sociais em plataformas.
- `prompts/`: instruções editáveis. Dados do feed não são instruções.
- `scripts/dev.ts`: supervisão de ambos os processos e encerramento do grupo.

## Convenções e segurança

TypeScript strict. Português do Brasil na interface. Nenhum segredo em client components ou mensagens de erro. `.env`, SQLite e perfis locais nunca entram no Git. Sem commits/push sem pedido.

`readAIEnvironment()` relê somente AI_* de .env/.env.local sem alterar process.env/autenticação do agente. Arquivos locais prevalecem; testes sempre ORBIT_ENV_FILE="" para não consumir chave real. HTTP privado continua bloqueado; usuário escolheu manter HTTPS. Diagnósticos não devem mostrar valores de chave.

O usuário configura `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` no .env; não ler/exibir a chave em chat ou logs. HTTP só para endpoint loopback. Não seguir redirects com credenciais. Filtrar cabeçalhos dos SDKs na fronteira de fetch: OPENAI_CUSTOM_HEADERS/ANTHROPIC_CUSTOM_HEADERS não podem herdar autenticação do agente. Timeout de 45s abrange headers e corpo. Não usar autenticação herdada do agente para chamar APIs do app.

Orçamento diário usa UTC. Sem usage, reserva conservadora permanece. Sem preços explícitos, custo desconhecido (não zero). Não liberar reservas ambíguas automaticamente. Cache é por item concluído, sem reclassificação quando o perfil muda.

Sem download/proxy de mídia: thumbnail remota é carregada pelo navegador. Resumo de RSS não é resumo do vídeo completo; indicar título/descrição e duração desconhecida. Testes usam fixtures sintéticas identificadas apenas nos testes; nunca seed de notícias fictícias em produção.

UI segue `PRODUCT.md`, `docs/surface-orbit.md` e `DESIGN.md`. Não adicionar controles sem comportamento nem métricas inventadas. Usar o fluxo `/browse` para trabalho de navegador solicitado; e2e pode usar Playwright CLI.
