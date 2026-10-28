# Orbit Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Briefing com fontes, tópicos, feedback e perfil aprendido, preservando os dados da fase 1.

**Architecture:** Migrações aditivas acrescentam tópicos, briefing cacheado e feedback por item. O worker usa o modelo de briefing explicitamente configurado; nenhuma página chama IA. Sinais locais ajustam pesos de temas persistidos no perfil e entram nos próximos prompts sem reclassificar itens em cache.

**Tech Stack:** Stack existente, sem novas dependências.

**Spec:** PROJETO.md e aprovação explícita da fase 2 via diálogo. Modelos/endpoint continuam configuráveis nos dois protocolos.

## Global Constraints

- Fases 3–5 não autorizadas; nenhuma coleta social ou agendamento nesta fase.
- Sem perder dados existentes, chaves, orçamento, fencing de lease ou timeout de corpo.
- Briefing sempre com IDs de fontes validados, sem links gerados pelo modelo.
- Até 8 tópicos, idealmente 5–8 quando há material; com poucos itens, dizer que a amostra é pequena.
- Modelo de briefing e preços próprios são explícitos; nenhuma troca automática de fornecedor/modelo.
- Não chamar APIs pagas nos testes; fixtures apenas em bancos isolados.

## Review Focus

- IDs inventados/repetidos ou omitidos: rejeitar lote e não persistir agrupamento parcial.
- Curtida repetida e reversão: atualizar perfil por delta, sem acumulação artificial.
- Alteração manual de pesos: deve sobreviver a novos sinais e continuar visível.
- Cache de briefing: repetir o mesmo snapshot não pode cobrar novamente; mudança real deve invalidar.
- Migração: dados e classificações da fase 1 devem permanecer legíveis.

### Task 1: Dados e feedback

Files: src/db/schema.ts, drizzle/, src/lib/feedback.ts, tests/feedback.test.ts.
Interfaces: `applyFeedback(db, rawId, action)` e `learnedWeights(db)`; voto, salvo, visto e clique são locais. Ranking usa nota original mais peso do tema, limitado a 0–100.
- [x] RED: testar votos reversíveis, salvar/visto, cliques limitados, perfil editado e IDs inexistentes.
- [x] Migração aditiva com topics, briefings, feedback e pesos no interest_profile.
- [x] GREEN: persistência transacional de feedback e pesos.

### Task 2: Briefing e agrupamento

Files: src/ai/request.ts, src/ai/briefing.ts, prompts/briefing.md, src/lib/config.ts, src/lib/run.ts, tests/briefing.test.ts.
Interfaces: `generateBriefing(db, config, assertActive?, signal?)` produz briefing persistido; `validateBriefing(text, ids)` valida fontes exatas.
- [x] RED: fontes inválidas, cache, limite de orçamento e recuperação sem IA configurada.
- [x] Extrair reserva/retry compartilhados preservando a cobertura existente.
- [x] Agrupar e resumir somente itens habilitados, não spam, coletados nas últimas 24h; cache por snapshot/modelo/prompt/perfil/dia UTC.
- [x] GREEN: erros de briefing preservam classificação e briefing anterior.

### Task 3: Interface e verificação

Files: src/app/page.tsx, src/app/components.tsx, src/app/actions.ts, src/app/perfil/page.tsx, src/app/configuracoes/page.tsx, src/app/globals.css, tests/e2e/orbit.spec.ts, README.md, CLAUDE.md.
- [x] RED: e2e de salvar/já vi, ranking por feedback e perfil editável.
- [x] Home com briefing, fontes por tópico e aviso de recorte; controles acessíveis e filtros salvos/vistos.
- [x] Meu perfil com interesses editáveis e pesos aprendidos ajustáveis; cliques alimentam sinais sem bloquear abertura do original.
- [x] GREEN: testes completos, typecheck, build e e2e de produção desktop/mobile.
- [x] Documentar decisões e parar para teste/OK antes da fase 3.

## Decisions

- Aprendizado é transparente e determinístico: voto +/-3, salvo +1, primeiro clique +1; os pesos afetam ranking local e próximos prompts.
- Pesos editáveis entre -20 e 20; ranking ajusta 2 pontos por unidade. Nenhuma reclassificação paga de itens concluídos.
- Sem AI_BRIEFING_MODEL, a interface explica como habilitar e preserva as recomendações.
- Ruling: acumular sinais sem truncar no banco preserva reversibilidade; exibição/ranking são limitados. Custo: sinais opostos podem primeiro reduzir um excedente. Semântica descrita em Meu perfil e README.
- Ruling: briefing reduzido pelo orçamento mantém cache do snapshot e identifica explicitamente o corte com contagens. Custo: aumentar somente o teto não refaz esse recorte até mudar conteúdo, perfil ou dia UTC.
- Ruling: fencing prevalece sobre reaproveitamento após falha abrupta. Resultado pago não persistido pode gerar novo custo na recuperação; reserva anterior nunca é liberada automaticamente. Limite documentado.

## Verification ledger

- Task 1 complete: feedback reversível, salvar/visto/clique e pesos editáveis em SQLite real.
- Task 2 complete: fontes exatas, retry cobrado, duas respostas inválidas preservam histórico; saldo insuficiente sem cache não chama endpoint; cache funciona com saldo esgotado.
- Task 3 complete: UI de briefing, fontes, filtros, feedback e Meu perfil em Chromium desktop/mobile, sem overflow global. Migração de banco da fase 1 preserva dados e notas.
- Review independente: corrigida indicação do corte por orçamento e normalização do tema, ambas com testes RED→GREEN. Semântica de teto e custo após falha abrupta documentadas, sem relaxar fencing.
- Suite: 32 testes; typecheck/build e e2e de produção executados na entrega. Nenhuma chamada paga, commit ou fase 3.
