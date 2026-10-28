# Orbit Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Instagram e Valete+ com login manual, leitura limitada e falhas isoladas.

**Architecture:** Reutilizar perfis, contrato de coletores, allowlist e worker existentes. Instagram lê apenas posts/legendas reconhecidas no DOM. Valete+ usa GET /api/post?filter=all na sessão do app, valida JSON e resolve permalinks a partir de links reais do feed; HTML vira texto em DOMParser inerte.

**Tech Stack:** Stack existente, sem novas dependências.

**Spec:** PROJETO.md, aprovação explícita da fase 4 e https://github.com/PedroRBC/valete-plus-api. Fase 5 ainda não autorizada.

## Global Constraints

- Login manual em perfis exclusivos; não acessar contas reais nos testes.
- Não coletar comentários de terceiros como legenda, stories, mensagens ou dados de perfis.
- Não criar slugs/URLs de artigos; itens sem permalink observado são omitidos e ausência total causa erro claro.
- Valete: primeira página apenas; limite de resposta 2MB e trechos de até 12.000 caracteres, sem HTML renderizado.
- Cookie/senha nunca exportado ou incluído no registro, log ou prompt.
- CAPTCHA/verificação, HTML de login e 429 interrompem fonte sem retries automáticos.

## Review Focus

- Instagram sem legenda reconhecida: guardar metadados, não misturar comentários nem inventar texto.
- Valete 200 text/html ou redirect: exigir login, não interpretar como JSON.
- Repost/canonical: link deve vir do DOM da origem correta e IDs permanecer distintos dos Article.id.
- HTML malicioso: texto inerte, sem scripts, imagens baixadas ou dangerouslySetInnerHTML.
- Mudança de layout e permalinks ausentes: erro isolado, nenhuma fonte alternativa inventada.

### Task 1: Coletores e testes
- [x] RED em Chromium com fixtures Instagram e API Valete; original/repost, fontes, HTML/login e URLs inseguras.
- [x] Seletores separados; GET Valete com redirect bloqueado, limite de corpo e sessão do app.
- [x] GREEN em DOM sintético sem rede externa.

### Task 2: Integração
- [x] Generalizar metadados das quatro plataformas, login, registro, filtros e evidência.
- [x] Migração aditiva e testes de preservação de dados.
- [x] Respeitar Retry-After por fonte e continuar outras coletas.

### Task 3: Entrega
- [x] Testes completos, produção e2e, controles responsivos.
- [x] README/CLAUDE atualizados; declarar limitações de autenticação/layout e da primeira página.
- [x] Parar para teste/OK antes da fase 5.

## Verification ledger and rulings

- RED→GREEN para Instagram, API Valete, HTML inerte, login200/redirect, Retry-After e ausência de permalink. Perfis reais não acessados.
- Revisão independente dos dois coletores: remover capas de buckets genéricos, tolerar metadados nulos/lista101 e distinguir JSON truncado de login. Três regressões reproduzidas em RED e corrigidas.
- Ruling: primeira página de feed Valete, somente links observados no DOM. Custo: alguns posts podem ser omitidos até validar o layout real; nenhuma URL é inventada.
- Ruling: Instagram mantém legenda vazia quando seletor não a reconhece. Custo: análise limitada a metadados, em vez de coletar comentários ou texto de terceiros indevidamente.
- Ruling: capas Valete só da origem do app; sem amostra autenticada, não liberar CDNs/buckets arbitrários.
- Documentação e comandos mantêm login manual e falha isolada. Nenhuma API paga, conta real, commit ou fase 5 executado.
