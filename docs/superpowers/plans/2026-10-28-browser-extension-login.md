# Orbit Browser Extension Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Login normal no Helium e coleta pela extensão, sem abrir Chromium automatizado nem exportar cookies.

**Architecture:** Extensão MV3 lê apenas os quatro feeds autorizados em abas próprias do navegador normal. Uma ponte loopback do Orbit usa pareamento temporário, token aleatório e fila SQLite; o worker recebe metadados validados e conserva a pipeline atual. O comando de login passa a abrir o manipulador HTTPS padrão do sistema.

**Tech Stack:** Stack existente, extensão em TypeScript compilada com esbuild, APIs Chrome com tipos oficiais.

**Spec:** Pedido explícito para login no navegador habitual; opção “Extensão no Helium” aprovada. Fase 5 não foi autorizada por essa alteração.

## Global Constraints

- Nenhuma leitura/exportação de cookies, senhas ou tokens das plataformas.
- Sem cookies/debugger/webRequest nas permissões da extensão. Acesso apenas aos quatro sites e loopback.
- Código de pareamento expira, é de uso único e possui limite de tentativas; tokens ficam só em storage.local e hash no banco.
- Origem da extensão precisa ser chrome-extension://ID válido; endpoints recusam páginas comuns e LAN.
- Requisições e metadados validados; destino de coleta é fixo por plataforma. Nunca aceitar código/URL arbitrários do servidor.
- Não alterar navegador padrão, instalar extensão automaticamente ou abrir/cerrar abas do usuário.
- Extensão abre/fecha somente suas abas; login permanece manual. Verificações param a fonte.
- Navegador precisa estar aberto. Sem extensão conectada, erro claro; sem fallback oculto para Playwright.
- Preservar banco, feedback, cache, orçamento, fontes e perfis antigos (sem apagá-los).

## Review Focus

- Requisição de página externa fingindo extensão, token revogado, pareamento reutilizado e brute force.
- Job vencido ou devolvido por outra sessão, payload excessivo, URL privada ou plataforma diferente.
- Extensão com navegador fechado, site sem login e falha de injeção: não marcar como coleta concluída.
- Falha durante coleta: limpar regras DNR/abas próprias e não alterar páginas existentes.
- Atualizar login sem atualizar worker seria correção incompleta; ambos devem usar o novo fluxo.

### Task 1: Ponte e segurança
Files: src/lib/extension.ts, src/db/schema.ts, drizzle/, src/app/api/extension/[action]/route.ts, src/proxy.ts, tests/extension.test.ts.
- [x] RED para pareamento, revogação, origem, expiração, payload e URLs.
- [x] Fila durável e estado de conexão no SQLite, com autenticação por token.
- [x] GREEN sem chamar serviços externos.

### Task 2: Extensão e leitores
Files: browser-extension/*, scripts/build-extension.ts, src/collectors/readers.ts, src/collectors/extension.ts, registry.ts.
- [x] Compartilhar leitores atuais sem importar Node/Playwright no bundle.
- [x] Popup para parear e abrir sites, service worker com alarmes, abas próprias e DNR conservador.
- [x] Worker usa a ponte; janela automatizada não é mais o login normal.
- [x] Verificar build da extensão e seu comportamento em Chromium isolado, sem contas reais.

### Task 3: Experiência e documentação
Files: scripts/login.ts, src/app/conectar/page.tsx, src/app/fontes/page.tsx, actions.ts, README.md, CLAUDE.md, tests/e2e/.
- [x] Login abre navegador padrão normal; tela Conectar gera código e permite revogar.
- [x] Instruções para carregar extensão local no Helium e estado real de conexão.
- [x] Rodar testes, typecheck, build e e2e de produção. Não afirmar instalação/login real sem validação do usuário.

## Approved trade-off

Instalação manual única da extensão; coleta exige o navegador aberto. Não há porta CDP ou cópia de perfil principal.

## Verification ledger and review rulings

- Código temporário, uso único, tentativas, origem, tokens revogados, URLs e fencing verificados em testes.
- E2E carrega a extensão real em Chromium isolado, pareia pelo popup, recebe job do worker e persiste metadados. Também testa revogação, dados inválidos, abas preexistentes e limpeza de regras DNR.
- Revisão independente apontou resultado inválido com timeout enganoso: corrigido para erro imediato; thumbnail inválida é descartada sem perder o item. Regressões RED→GREEN.
- Revisão apontou Host spoof quando a UI escuta na LAN: corrigido com listener próprio, bind e verificação de peer em 127.0.0.1. A porta Next sempre recusa rotas da ponte. Custo: porta adicional (PORT+1), configurável.
- Ruling: abas ativadas pelo usuário são preservadas e deixam de ser gerenciadas; sem janela normal do navegador, não abrir janela de coleta. Essa escolha prioriza não fechar abas que a pessoa assumiu.
- Ruling: as permissões dos quatro feeds são declaradas no manifesto e aprovadas ao instalar; as fontes só são coletadas quando habilitadas no Orbit. Não são solicitadas permissões de cookies/debugger/tabs/webRequest.
- Texto pequeno no popup foi corrigido para 14px; nenhum ignore ou supressão de design criado.
- Coleta é cancelada por eventos de ativação da aba e por mudança de URL; não depende de document.visibilityState, que o Chromium headless reporta como visible em todas as páginas. A aba assumida pelo usuário é preservada.
- Verificação final: 64 testes, typecheck/build sem warning e 7 e2e de produção, incluindo extensão real, bootstrap MAIN, leitor ISOLATED, recepção no worker, resultado inválido, revogação e abas preexistentes preservadas. Auditoria runtime sem vulnerabilidades reportadas.
- Instalação da extensão no perfil real do Helium e login Google real ainda dependem da ação do usuário. Nenhuma API paga, cookie exportado, commit ou fase 5.
