# Orbit Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fora da bolha com RSS público, agenda três vezes ao dia, painel de limites e entrega local documentada.

**Architecture:** Notícias externas usam coletor HTTPS próprio com proteção SSRF e DNS fixado por conexão. O worker agenda filas duráveis com node-cron e lease SQLite. Notícias são classificadas uma vez, mas ficam separadas das recomendações/briefing do algoritmo. A extensão continua responsável pelos feeds pessoais.

**Tech Stack:** Stack existente mais node-cron; TLS/DNS e streaming via biblioteca padrão Node.

**Spec:** PROJETO.md; fase 5 autorizada explicitamente após entrega da melhoria de login.

## Global Constraints

- Nenhuma fonte RSS de notícias predefinida ou notícia fictícia. Usuário cadastra feeds públicos HTTPS.
- Não acessar rede privada/loopback/link-local, seguir redirect sem revalidar ou permitir DNS rebinding.
- Apenas XML limitado, não baixar artigos/mídia. Título/trecho RSS como evidência, sem afirmar leitura integral.
- Fora da bolha vem de fonte EXTERNA e não prova que o algoritmo omitiu os assuntos. Não misturar no briefing pessoal.
- Agenda padrão 08:00,14:00,20:00 no fuso do sistema, editável/pausável. App precisa estar rodando; navegador aberto para feeds pessoais.
- Sem retroativo agressivo quando a máquina esteve desligada; sem filas/execuções duplicadas.
- Preservar teto/reservas/unknown usage e exigir preços reais para estimativa em USD.
- Nenhuma API paga, autenticação real ou instalação de extensão automática nos testes.

## Review Focus

- DNS devolve IP privado, IPv4 mapeado em IPv6 ou mistura de IPs: bloquear antes do socket.
- Redirect público aponta à LAN, XML excessivo/DTD ou resposta lenta: parar fonte e manter dados anteriores.
- RSS externo aparece como se fosse feed pessoal: impedir no SQL e rotular a seção com fonte/evidência.
- Dois callbacks/worker reiniciado/DST: enfileirar cada horário uma vez e respeitar execução/cooldown.
- Custo ausente/desconhecido, limite esgotado e novo dia UTC: estado honesto, nunca custo zero inventado.

### Task 1: RSS externo
- [x] RED: URL/IP, DNS/redirect, XML, links sociais e limites.
- [x] Coletor público com conexão TLS para IP validado e hostname original verificado.
- [x] Source kind news_rss; classificação e seleção complementar, sem misturar no briefing/feeds.

### Task 2: Agenda e orçamento
- [x] RED: agenda por fuso/horário, duplicatas, desabilitar, execução ativa e orçamento.
- [x] Agenda node-cron só enfileira sob lease; atualiza sem reiniciar e registra origem agendada/manual.
- [x] Estado/tetos/consumo atual no painel, com valores desconhecidos sinalizados.

### Task 3: Interface e entrega
- [x] Cadastro/pausa de RSS, Fora da bolha com 2–3 itens quando houver dados, controles de agenda.
- [x] E2E produção, mobile, migrações e todos os testes.
- [x] README final, CLAUDE/PROJETO atualizados, sem commits/push.
- [x] Pausar para teste final do usuário. Declarar login real, chave/modelo e feeds ainda não configurados.

## Verification ledger and rulings

- 91 testes e 8 e2e de produção; typecheck/build verificados. O worker real disparou cron em teste isolado, com fonte privada bloqueada antes da rede e sem IA.
- RSS público real: BBC World retornou 27 entradas HTTPS com trechos, sem persistir amostra nem fazer IA paga.
- Revisão independente de public-feed/news/scheduler não confirmou bugs alta/média. Chamador cron e recuperação de runs órfãos conferidos no worker; hostname com ponto final normalizado e cooldown usa o horário recebido.
- Separação testada: notícia externa não entra no briefing pessoal/Vale a pena ver; notícia sem IA é rotulada como trecho original; perfil pessoal não é enviado em lotes exclusivamente externos.
- Ruling: HTTPS público na porta padrão, DNS fixado, 2MB/20s e XML sem DTD/compactação. Custo: RSS que ignora identity ou depende de autenticação/porta especial é recusado, sem abrir rede privada ou proxy genérico.
- Ruling: máximo automático padrão 6 por 24h, editável por env entre1–12, além de cron/fuso e mínimo5min. Evita cron excessivo; não limita uma fonte com requests paralelos. Execuções perdidas não são repetidas em lote.
- Ruling: diversidade de temas é só comparação com a amostra recente; não inferir crenças, não alegar cobertura global nem omissão comprovada do algoritmo.
- Fontes/interesses/chave reais não foram presumidos; extensão no perfil Helium e análise com API real precisam do teste final do usuário. Dados prévios preservados. Nenhum commit/push.

