# Orbit Editorial Editions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar leitura editorial, poucos temas controlados, edições gerais 08h/16h e Web Push privado.

**Architecture:** Reutilizar SQLite/Drizzle, fila `collector_runs`, lease e worker sequencial. Separar edições gerais dos briefings pessoais; usar RSS públicos seguros e orçamento de IA existente. Publicação e outbox push são atômicas.

**Tech Stack:** TypeScript strict, Next.js App Router, React, SQLite/Drizzle, node-cron, Web Push, Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-editorial-editions-design.md`

## Global Constraints

- Somente worktree; preservar alterações locais do checkout principal.
- Sem commit, push, publicação, merge ou TrueNAS sem autorização específica.
- Interface pt-BR; login, CSRF e cache offline estático preservados.
- IA apenas no worker, fornecedor/modelo existentes, testes sem API paga.
- Sem fontes/interesses/notícias fictícios em produção.

## Review Focus

- Reinício entre publicação e push: outbox única e claim persistido impedem repetição.
- Retomada tardia/DST: gerar somente o slot recente, não uma tempestade retroativa.
- RSS republicado, sem data ou antigo: nunca promover conteúdo antigo como atual.
- Aliases com pesos opostos: média, auditoria e reversibilidade dos sinais posteriores.
- Dispositivo sem suporte/sem permissão/offline: orientação clara, sem prometer entrega.

### Task 1: Taxonomia e migração

**Files:** `src/lib/taxonomy.ts`, `src/db/taxonomy.ts`, `src/ai/classify.ts`, `src/lib/feedback.ts`, `prompts/classify.md`, perfil e testes relacionados.
**Interfaces:** catálogo IDs/labels; `consolidateTaxonomy(db)` chamado depois das migrations; helper compartilhado para labels/filtros.

- [x] Testar aliases, IDs permitidos, média dos pesos, auditoria, rollback, preservação dos vínculos e idempotência.
- [x] Implementar catálogo, classificação fechada, ajuste de pesos e migração determinística transacional.
- [x] Integrar abertura do banco e adaptar fixtures/labels/filtros.
- [x] Rodar testes taxonomy/feedback/classification/migration.

### Task 2: Edições gerais e fila

**Files:** `src/db/schema.ts`, `drizzle/`, `src/lib/editions.ts`, `src/ai/edition.ts`, `src/lib/run.ts`, `src/worker.ts`, `prompts/edition.md`, `tests/editions.test.ts`.
**Interfaces:** `queueDueEdition(db, owner, now)`, `runEdition(db, runId, config, control)`, tipo de execução `collection|edition` e edição vinculada à fila.

- [x] Testar chave única, fuso/DST, configuração ausente, atraso de até duas horas, sem backlog e retomadas limitadas.
- [x] Criar schema/migração e agenda separada com configuração explícita.
- [x] Coletar somente news_rss no servidor, selecionar cobertura temporal, excluir itens matinais à tarde, validar IDs/resumo/contexto/relevância e orçamento.
- [x] Persistir edição e outbox na mesma transação; testar falhas sem perder edição anterior.
- [x] Integrar worker/lease e rodar testes de fila/worker/edição.

### Task 3: Web Push

**Files:** `src/db/push-schema.ts`, `src/lib/push.ts`, `src/app/push-actions.ts`, `src/app/push-settings.tsx`, `public/sw.js`, `tests/push.test.ts`.
**Interfaces:** `queueEditionPush(db, editionId)` e `drainPush(db, assertActive, signal?)`; configuração por aparelho via Server Actions.

- [x] Testar inscrições inválidas/expiradas, limites, SSRF, duplicatas, claim ambíguo e payload discreto.
- [x] Implementar VAPID persistente, ações autenticadas, interface opt-in/teste/desativação e eventos SW.
- [x] Integrar tabelas/migração, UI e drenagem pelo worker.
- [x] Documentar HTTPS/Android/iOS/contato/serviços push/at-most-once.

### Task 4: Interface editorial e consulta

**Files:** `src/app/globals.css`, navegação/layout, home, `src/app/(app)/briefings/`, `src/app/(app)/temas/`, configurações, loading/error, `DESIGN.md`, `PRODUCT.md`, surface brief.
**Interfaces:** `/briefings` lista edições persistidas, `/briefings/[id]` abre edição autenticada; home destaca geral e mantém pessoal separado.

- [x] Inspecionar tokens/layout existentes e documentação local Next antes de alterar.
- [x] Implementar hierarquia editorial, leitura móvel e navegação secundária, sem dados inventados.
- [x] Mostrar fuso/agenda/período/fontes/estado e configurar agenda geral/push.
- [x] Verificar estados vazio/erro/carregamento, foco, contraste e alvos de toque por e2e.

### Task 5: Entrega verificada

- [x] Rodar `ORBIT_ENV_FILE='' npm test`, `npm run typecheck`, `ORBIT_ENV_FILE='' npm run build`, e e2e com dados isolados.
- [x] Revisar alterações integradas e corrigir falhas materiais. Revisão independente: P2 de Atom `updated` confundido com publicação; reproduzido e corrigido com teste, coluna newsPublishedAt e migração 0010. Sem outro achado importante.
- [x] Atualizar README/CLAUDE/docs com configuração, migração, evidências e roteiro físico.
- [x] Entregar arquivos e resultados, sem commit/push/NAS; explicitar limites e verificações não feitas.
