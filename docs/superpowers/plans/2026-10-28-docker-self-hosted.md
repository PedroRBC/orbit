# Orbit Self-Hosted (Docker, login, companion, PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Orbit passa a ser um serviço próprio com login, pensado para Docker (TrueNAS), acessível pelo celular como PWA, com a extensão conversando com o servidor pela API.

**Architecture:** Uma imagem com Next, worker e migrações supervisionados por `scripts/dev.ts`; SQLite WAL em `/data`; IA lida de `/config/orbit.env`. Contêiner em rede bridge, porta publicada `30480→3000`; domínio, proxy e Tailscale ficam a cargo do usuário. Login senha + TOTP sempre ativo. A extensão usa `/api/companion/*` no mesmo endereço do app (HTTPS, ou http só em loopback); a ponte loopback dedicada é removida e `/api/extension/*` continua recusado.

**Tech Stack:** Stack existente (Next 16.4, better-sqlite3, Drizzle, node-cron, tsx), `node:24-bookworm-slim`, Docker Compose, GitHub Actions + GHCR. Sem dependências novas.

**Spec:** Decisões aprovadas em chat em 28/10/2026: sem "modo servidor", login desde o início, companion pela API com permissão opcional por origem, `ORBIT_ALLOWED_HOSTS` obrigatório para acesso não local, dados em `/mnt/Configs/Apps/orbit` e backups em `/mnt/Files/Backups/orbit`, repositório e GHCR privados.

## Global Constraints

- Nunca colocar `.env`, bancos, perfis, `orbit.env` ou segredos na imagem, no Git ou em logs.
- Contêiner sem root (`568:568` por padrão), `cap_drop: ALL`, `no-new-privileges`, raiz somente leitura.
- Preservar lease, agenda, deduplicação, orçamento e recuperação; recriar o contêiner não perde dados nem duplica jobs.
- Provedor/protocolo/modelos de IA continuam configuráveis por `AI_*`; nenhum valor padrão novo.
- Next sempre recusa `/api/extension/*`. Não relaxar Origin/CSRF globalmente; exceções são explícitas por rota.
- Testes sem API paga e sem o banco real (`ORBIT_ENV_FILE=""`, bancos temporários).
- Sem alterar DNS, roteador, proxy ou o TrueNAS real; entregar guia.

## Review Focus

- Recriar o contêiner no meio de uma coleta: execução volta à fila uma vez, lease antigo expira, sem item duplicado.
- Volume de dados com dono errado: falha clara no log, não banco vazio silencioso.
- Imagem nova sobre banco antigo: migrações aplicadas uma vez; rollback de imagem após migração exige restaurar backup.
- Host/Origin forjados, cookie de sessão roubado/expirado, brute force de senha/TOTP, replay de código TOTP.
- Extensão apontando para HTTP remoto, redirect, origem não pareada, token revogado.

---

## F1 — Contêiner e persistência

### Task 1: Saúde do worker e backup consistente
**Files:** Modify `src/lib/store.ts`, `src/app/status/page.tsx`; Create `src/app/api/health/route.ts`, `src/db/backup.ts`, `scripts/backup.ts`; Test `tests/store.test.ts`, `tests/backup.test.ts`; Modify `package.json` (`db:backup`).
**Interfaces:** Produces `workerOnline(db: OrbitDB, now = Date.now()): boolean` (heartbeat < 30 s) e `backupDatabase(source: string, directory: string, now = new Date()): Promise<string>` (arquivo `orbit-YYYYMMDD-HHMMSS.db`, API online do SQLite, `integrity_check` = ok).
- [x] RED: `workerOnline` falso sem heartbeat/antigo, verdadeiro com heartbeat recente.
- [x] RED: backup de banco WAL com linhas ainda no `-wal` contém as linhas e passa `integrity_check`; diretório inexistente é criado com modo 700.
- [x] GREEN; status usa `workerOnline`. `GET /api/health` → 200 `{ ok: true, worker: true }` ou 503, `Cache-Control: no-store`, sem dados pessoais.

### Task 2: Imagem e Compose
**Files:** Create `Dockerfile`, `.dockerignore`, `compose.yaml`; Modify `scripts/dev.ts` (extensão só compilada em dev), `.gitignore` se preciso.
- [x] Multi-stage: `npm ci` → `npm run build` → `npm prune --omit=dev`; runtime copia só o necessário; `USER 568:568`; `/data` e `/backups` pertencem a 568; `HEALTHCHECK` via `/api/health`.
- [x] Env da imagem: `ORBIT_HOST=0.0.0.0`, `PORT=3000`, `ORBIT_DB_PATH=/data/orbit.db`, `ORBIT_ENV_FILE=/config/orbit.env`, `NODE_ENV=production`.
- [x] Compose: `init`, `restart: unless-stopped`, `stop_grace_period: 30s`, `read_only` + tmpfs `/tmp` e `/app/.next/cache`, porta `${ORBIT_PORT:-30480}:3000`, volumes `/data`, `/config:ro`, `/backups`.
- [x] Verificar: build; start; health; worker com lease; SIGTERM limpa lease; recriar mantém dados; banco com migrações antigas sobe migrado; execução `running` órfã volta à fila uma vez; volume sem permissão falha com mensagem clara; `docker history`/conteúdo sem `.env`/banco.

### Task 3: Guia TrueNAS
**Files:** Create `docs/deploy.md`; Modify `README.md`, `.env.example`.
- [x] Datasets, ACL 568, `orbit.env` 600, YAML do Custom App, variáveis, portas, atualização por tag, backup (Cron Job + snapshot), restauração, limites de rollback, diagnóstico.

## F2 — Login e companion pela API

### Task 4: Autenticação
**Files:** `src/db/schema.ts` + migração (`sessions`), `src/lib/auth.ts`, `scripts/auth.ts`, `src/app/login/`, `src/app/(app)/` (grupo protegido com o shell atual), `src/proxy.ts`, `src/app/actions.ts`.
**Interfaces implementadas:** `hashPassword`, `verifyPassword` (scrypt), `totpCode(secret, step)`, `attemptLogin(db, input, now)` (±1 passo, sem replay), `createSession(db): string`, `sessionValid(db, token, now)`, `requireSession()`, `revokeAllSessions(db)`, `clearLoginLocks(db)`.
- [x] Senha/TOTP/recuperação configurados por `npm run auth -- setup` (terminal, sem log). Sem credencial configurada, nada abre.
- [x] Cookie `__Host-orbit_session` HttpOnly/Secure/SameSite=Strict, expiração fixa de 30 dias, hash no banco; logout e "sair de todos".
- [x] Login só por HTTPS (`X-Forwarded-Proto`) ou loopback; limite de 5 erros/15 min por cliente (último salto do X-Forwarded-For) e desbloqueio por CLI. Na revisão, o bloqueio global foi removido porque permitiria que qualquer pessoa trancasse o dono fora; limitar o tráfego também no proxy.
- [x] Proxy valida a sessão no banco: Host local ou `ORBIT_ALLOWED_HOSTS`; sem sessão → `/login` (GET) ou 401; rotas públicas: `/login`, `/api/health`, `/api/companion/*`, manifest/ícones/SW/offline. Cada página, Server Action, rota e layout protegido chama `requireSession()` (layout sozinho não protege payload RSC).

### Task 5: Companion pela API
**Files:** `src/lib/extension-http.ts`, `src/app/api/companion/[action]/route.ts`, remover `src/extension-server.ts`/`bridgePort`, `browser-extension/*`, `src/app/(app)/conectar/page.tsx`, rota de download da extensão.
- [x] Pareamento aceita origem `http` loopback ou `https` com Host permitido; demais regras atuais intactas.
- [x] Extensão: `optional_host_permissions: ["https://*/*"]`, pede a origem digitada no popup; `/api/companion/*`; recusa http remoto.
- [x] Remover `npm run login`, `default-browser.ts`, `openBrowserLogin`; links normais para os sites.

## F3 — PWA e celular
- [x] `manifest.ts`, ícones 192/512/maskable/apple-touch com procedência, metas iOS, `themeColor`.
- [x] `sw.js` mínimo: só `/offline.html` em cache; navegações com rede primeiro; nunca POST/dados.
- [x] Aviso de desconexão; auditoria de toque/legibilidade em 390 px; fontes com "depende do navegador" e última coleta.

## F4 — CI, PR e documentação
- [x] Workflow: testes, typecheck, build, imagem `ghcr.io/pedrorbc/orbit:<versão>` e `sha-<curto>` em push na `main` ou tag `v*`; verificação de pacote privado e tags/digest no workflow.
- [x] Varredura de segredos/dados pessoais antes do push; PR; CLAUDE.md e README atualizados com links reais.

## Evidências e pendências (28/10/2026)

- F1–F3 executadas e verificadas localmente: 123 testes unitários, typecheck, build e 14 e2e de produção. Testes de imagem, backup/WAL, recriação, migrações, queda do worker, sessão e proxy HTTPS registrados no PR.
- Revisão independente encontrou vazamento RSC com cookie inventado, redirect com tab, bloqueio global, corpo sem limite, reuso do TOTP de setup e códigos de recuperação curtos. Corrigidos em `4ce91eff`; regressões incluídas.
- CI do PR aprovado em https://github.com/PedroRBC/orbit/actions/runs/40694846180.
- Instalação real no TrueNAS, proxy/domínio e Android/iPhone continuam pendentes do usuário; não alterar o NAS nem fazer merge.
- F4 publicada e verificada: https://github.com/PedroRBC/orbit/actions/runs/40696551059. Pacote privado, tags `0.2.0-rc.2` e `sha-f56c736`, ambas em `sha256:247766a60bf7b000e1fae051680cdc3c69ea449190ce24e38d9ed05fcb332c0c`. Verificação pela API e registry dentro do workflow. Evidências detalhadas em docs/validation-self-hosted.md. O pacote privado exige credencial de leitura no TrueNAS, fornecida pelo usuário diretamente na interface do NAS.
