# Orbit Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Coletar home do YouTube e feed Para você do X com sessões locais e leitura apenas.

**Architecture:** Coletores implementam o contrato collect() já existente, com seleção por tipo de fonte. Cada plataforma possui perfil persistente independente e seletores isolados. Login é feito manualmente pelo usuário em comando dedicado; o worker nunca preenche credenciais nem enfrenta verificações.

**Tech Stack:** Stack existente mais Playwright como dependência de execução.

**Spec:** PROJETO.md; fase 3 aprovada explicitamente após a entrega da fase 2. Fases 4–5 continuam bloqueadas.

## Global Constraints

- Não navegar em contas reais nos testes. HTML sintético em Chromium, com rede externa bloqueada.
- Perfis dentro de data/browser-profiles, fora do Git; nunca usar ou copiar o perfil principal do navegador.
- Nenhuma ação social. A única interação além de navegação/scroll é selecionar a aba Para você do X.
- Delays de 900–1800ms, até 4 scrolls, máximo 20 itens e timeout total de 45s.
- Sem download de arquivos/mídia, gravação de cookies, screenshots de contas ou logs de conteúdo.
- CAPTCHA/verificação/login expirado/perfil ocupado: parar fonte e mostrar motivo seguro, sem retentativa agressiva.
- Dados e migrações das fases anteriores preservados.

## Review Focus

- DOM menciona CAPTCHA numa postagem: não confundir conteúdo com tela de verificação.
- Quote/repost/anúncio: extrair post original correto, deduplicar ID e excluir ads detectáveis.
- Navegador/profile ocupado ou ausência de login: erro isolado, RSS continua.
- Perda de lease/cancelamento: encerrar o contexto e não persistir resultados pelo worker antigo.
- Metadados da home não incluem descrição/transcrição: resumo precisa declarar evidência real.

### Task 1: Tipos e parsers

Files: src/collectors/types.ts, errors.ts, selectors/youtube.ts, selectors/x.ts, browser.ts, tests/browser-collectors.test.ts.
- [x] RED: fixtures Chromium para extração, duração, ads, URLs, duplicatas e verificações sem interações sociais.
- [x] Implementar parsers somente leitura; URLs/imagens normalizadas com hosts oficiais.
- [x] GREEN: testes de DOM com rede interceptada/bloqueada.

### Task 2: Sessões e worker

Files: scripts/login.ts, src/collectors/browser.ts, registry.ts, src/db/schema.ts, drizzle/, src/lib/run.ts, package.json.
- [x] Fonte identifica tipo/plataforma; RSS conserva ID de canal, fontes de navegador não exigem canal.
- [x] Comando `npm run login -- youtube|x` abre perfil próprio para login manual.
- [x] Worker abre contexto persistente por execução, fecha em finally, lê sequência limitada e pára em bloqueios.
- [x] Testar falha isolada e adaptação dos dados existentes.

### Task 3: Interface e entrega

Files: src/app/fontes/page.tsx, actions.ts, page.tsx, status/page.tsx, src/ai/classify.ts, README.md, CLAUDE.md, tests/e2e/orbit.spec.ts.
- [x] Ativar/pausar feeds pela interface; instruções de login e estado por fonte.
- [x] Filtro X/YouTube, metadados e evidência corretos, duração conhecida quando visível.
- [x] Testes completos, build, e2e de produção e revisão focada nos novos coletores.
- [x] Documentar o que não foi validado em feeds reais e parar antes da fase 4.

## Verification ledger and decisions

- 40 testes de lógica/DOM e 6 e2e passaram; produção, typecheck e auditoria verificados. Fixtures Chromium com rede externa interceptada; nenhuma conta real ou API paga utilizada.
- Migração aditiva backfill de source_items preserva origens existentes. Vídeo em RSS+home fica único e continua visível enquanto uma fonte associada estiver ativa.
- Ruling: manter sources.channelId como identificador legado, usando URL canônica para feeds. Evita renomear/reconstruir tabelas existentes; kind seleciona o coletor.
- Ruling: allowlist conservadora bloqueia POSTs não necessários, WebSockets e mídia, mesmo via fetch. Custo: mudanças legítimas na plataforma podem exigir ampliar consultas específicas, nunca liberar ações sociais genericamente.
- Revisão independente focada identificou sufixo google.com amplo; teste RED reproduziu acesso a Apps Script/Gmail. Sufixo removido, preservando apenas hosts necessários.
- Login, CAPTCHA e layout de contas reais dependem da validação manual do usuário. Nenhum CAPTCHA contornado, cookie exportado, dado real coletado, commit ou fase 4 executado.
