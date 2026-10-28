# Orbit Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar YouTube RSS, recomendações com IA configurável, onboarding e status em localhost, com um comando.

**Architecture:** Next.js renderiza dados de SQLite/Drizzle. Um worker separado executa uma fila durável de coletas sequenciais e classifica itens pendentes. SDKs oficiais OpenAI e Anthropic atendem protocolos compatíveis com URL base, chave e modelo no servidor.

**Tech Stack:** TypeScript, Next.js App Router, Tailwind 4, better-sqlite3, Drizzle, Zod, rss-parser, tsx, Vitest, Playwright.

**Spec:** PROJETO.md; alteração aprovada na conversa: endpoints OpenAI Compatible ou Anthropic Compatible, configuráveis por URL/chave/modelo; canais e interesses cadastrados no app.

## Global Constraints

- Somente a fase 1 está autorizada. Parar para teste antes da fase 2.
- Português do Brasil; dark mode; localhost por padrão; sem canais ou conteúdo fictícios.
- Chaves no .env; nunca expostas ao cliente, logs, banco de conteúdo ou Git.
- Metadados de canais via RSS oficial; nenhuma sessão Google necessária.
- Respostas JSON validadas, retry limitado e cache por item.
- Teto diário em tokens desde a primeira chamada; orçamento em dinheiro apenas com preços explicitamente configurados.
- Não fazer chamadas pagas de teste; usar fixtures e servidor HTTP local nos testes de integração.
- Não criar commits ou publicar sem pedido do usuário.

## Review Focus

- Reinício durante coleta: fila deve recuperar trabalho sem reprocessar itens concluídos.
- RSS inválido, HTML ou redirecionamento inesperado: erro isolado e dados existentes preservados.
- Modelo retorna IDs extras, duplicados ou resumo inventado: rejeitar estrutura/IDs e exigir fontes; conteúdo factual ainda requer julgamento humano.
- Endpoint compatível sem usage: reservar consumo conservador, nunca considerar chamada gratuita.
- Configuração sem chave/perfil/canais e navegador mobile: onboarding acionável, sem coleta paga automática.

## File Structure

- `src/db/schema.ts`, `src/db/index.ts`, `drizzle/`: persistência e migrações.
- `src/lib/config.ts`, `src/lib/store.ts`: configuração de servidor e operações locais.
- `src/collectors/youtube.ts`: normalização de canal e RSS, interface RawItem.
- `src/ai/provider.ts`, `src/ai/classify.ts`, `prompts/classify.md`: protocolos e validação.
- `src/worker.ts`, `scripts/dev.ts`: fila, lease e execução conjunta.
- `src/app/`: recomendações, fontes, configurações e status.
- `tests/`: lógica, SQLite real, contratos HTTP locais dos SDKs e e2e.

### Task 1: Persistência e execução local

**Files:** package/config, src/db/*, src/lib/config.ts, src/lib/store.ts, scripts/dev.ts, tests/store.test.ts.

**Interfaces:** `openDatabase(path)` produz db/SQLite; `enqueueCollection(db)` cria uma execução sem duplicar pendências; perfil guarda interesses/exclusões sem valores presumidos.

- [x] Escrever testes para persistência, deduplicação, fila e orçamento; executar RED.
- [x] Definir schema e gerar migração versionada.
- [x] Implementar armazenamento e configuração validada; executar GREEN.
- [x] Criar comando que migra e inicia Next/worker; encerramento deve parar ambos.

### Task 2: Coletor RSS

**Files:** src/collectors/youtube.ts, tests/youtube.test.ts.

**Interfaces:** `normalizeChannel(input): string`; `parseYouTubeFeed(xml, channelId): RawItem[]`; `collectChannel(channelId): Promise<RawItem[]>`.

- [x] Testar IDs/URLs de canal, rejeição de URL arbitrária, XML incompleto/HTML, datas e deduplicação; executar RED.
- [x] Implementar leitura somente do host oficial com timeout e limite de corpo/itens.
- [x] Persistir idempotentemente e manter falhas por fonte; executar GREEN.

### Task 3: IA e worker

**Files:** src/ai/*, prompts/classify.md, src/worker.ts, tests/ai.test.ts, tests/worker.test.ts.

**Interfaces:** `classifyPending(db, config)` classifica lotes de até 5; `runCollection(db, dependencies)` executa fontes e registra estados.

- [x] Escrever fixtures de ambos os protocolos, resposta inválida, IDs estranhos, limites, cache e falha isolada; executar RED.
- [x] Implementar SDKs com endpoint configurável, retry próprio limitado e timeout.
- [x] Reservar orçamento antes da chamada, manter reserva em falha ambígua, reconciliar usage disponível.
- [x] Implementar lease SQLite/heartbeat e recuperação de fila abandonada; executar GREEN.

### Task 4: Interface e entrega

**Files:** src/app/*, tests/e2e.spec.ts, playwright.config.ts, README.md, CLAUDE.md, DESIGN.md.

**Interfaces:** ações de formulário locais validam dados e enfileiram; páginas consultam SQLite sem fazer IA na renderização.

- [x] Escrever e2e de onboarding, perfil, fontes, coleta e layout mobile antes da UI.
- [x] Construir interface escura em português com recomendações ranqueadas e filtros de tema/período.
- [x] Mostrar fontes, limitação do resumo, status do worker, erros e consumo reservado/real.
- [x] Documentar configuração privada dos dois protocolos, comando único, testes e limites.
- [x] Executar testes, typecheck, build e teste real desktop/mobile; corrigir defeitos materiais.

## Progress

- Aprovação e decisões de onboarding recebidas. Execução direta, sem commits.
- Ruling: guardar chaves somente no .env; a interface mostra configuração e instruções, sem receber ou devolver segredo.
- Ruling: imagens remotas carregam somente pelo navegador, sem proxy/otimização de mídia no servidor.
- Ruling: sem preço informado, custo em USD é desconhecido; teto conservador em tokens permanece obrigatório.
- Task 1: complete — SQLite real, fila idempotente, deduplicação e reservas diárias verificadas.
- Task 2: complete — normalização/limites testados; smoke test real leu 15 entradas de RSS oficial, sem persistir amostra.
- Task 3: complete — SDKs reais contra HTTP local; respostas inválidas, cache e orçamento verificados.
- Task 4: complete — onboarding, fontes, ranking/filtros e segurança cross-origin em Chromium desktop/mobile; versão de desenvolvimento e produção verificadas.
- Final review: revisor independente de código encontrou cinco problemas concretos. Reproduzidos por regressões RED; corrigidos cabeçalhos herdados, fencing de lease, timeout do corpo, seleção de lotes por saldo e isolamento de configuração inválida. Suite GREEN: 22/22.
- Final visual review: disposição fix; contraste de campos reproduzido por teste (1,96:1) e corrigido para pelo menos 3:1. Indicadores concluídos usam Lucide/rotulagem acessível. Fonte da referência seed documentada. E2E GREEN após a correção.
- Nenhum commit, push, API paga ou fase seguinte executado.
