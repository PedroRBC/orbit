# Orbit no Docker e no TrueNAS

Um contêiner roda a interface, o worker e as migrações. O banco SQLite (modo WAL) fica num volume persistente; a configuração de IA fica num arquivo separado, fora da imagem e fora do Compose.

> **Estado desta fase (F1):** o login ainda não existe; ele chega na F2. Até lá, deixe a porta acessível apenas na sua rede de confiança. Não publique na internet.

## Visão geral

| Item | Valor |
| --- | --- |
| Imagem | `ghcr.io/pedrorbc/orbit:<versão>` (privada; publicada na F4). Teste local: `docker compose up -d --build` |
| Porta interna | `3000` (HTTP). O Compose publica em `30480` por padrão (`ORBIT_PORT`) |
| Usuário | `568:568` (usuário `apps` do TrueNAS), sem root, sem capabilities, raiz somente leitura |
| `/data` | Banco `orbit.db` com `-wal`/`-shm`. Gravável pelo UID do contêiner, modo 700 |
| `/config` | `orbit.env` com as variáveis `AI_*`. Somente leitura, arquivo 600 |
| `/backups` | Cópias verificadas do banco |
| Saúde | `GET /api/health`: 200 com interface e worker vivos; 503 se o worker parou de sinalizar. O `HEALTHCHECK` da imagem usa essa rota |

A coleta pessoal (YouTube home, X, Instagram, Valete+) depende da extensão no navegador do seu computador. Com o computador desligado, o Orbit continua mostrando os dados já coletados e segue com RSS e IA. As fontes pessoais ficam com o aviso "navegador indisponível" até a extensão voltar.

## Instalação no TrueNAS SCALE 25.10

### 1. Pastas e permissões

Os outros apps deste NAS usam `/mnt/Configs/Apps/<app>`. O pool `Configs` tem um disco só, por isso os backups vão para `Files` (raidz1).

1. **Datasets → Add Dataset** em `Configs/Apps`: nome `orbit`, preset **Apps**.
2. **Datasets → Add Dataset** em `Files/Backups`: nome `orbit`, preset **Apps**.
3. No **Shell** do TrueNAS (System → Shell), como root:

```bash
install -d -o 568 -g 568 -m 700 /mnt/Configs/Apps/orbit/data /mnt/Files/Backups/orbit
install -d -o 568 -g 568 -m 700 /mnt/Configs/Apps/orbit/config
install -o 568 -g 568 -m 600 /dev/null /mnt/Configs/Apps/orbit/config/orbit.env
```

Se usar outro UID, troque `568` aqui e em `user:` no YAML.

### 2. Configuração de IA

Edite `/mnt/Configs/Apps/orbit/config/orbit.env` no Shell do TrueNAS (`nano`). Só as variáveis `AI_*` são lidas desse arquivo, e ele é relido a cada análise, sem reiniciar o app. Use os mesmos nomes do `.env.example`: `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_BRIEFING_MODEL`, preços e limites. O Orbit não escolhe fornecedor nem modelo por você.

A chave fica só nesse arquivo. Não a coloque no YAML: variáveis do Compose aparecem em `docker inspect` e na tela do app no TrueNAS. Com o arquivo vazio, o app abre e coleta, mas não analisa.

### 3. App personalizado

**Apps → Discover Apps → ⋮ → Install via YAML**, nome `orbit`:

```yaml
services:
  orbit:
    image: ghcr.io/pedrorbc/orbit:0.2.0
    init: true
    restart: unless-stopped
    stop_grace_period: 30s
    user: "568:568"
    read_only: true
    tmpfs:
      - /tmp
      - /app/.next/cache:uid=568,gid=568
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    ports:
      - "30480:3000"
    environment:
      TZ: America/Sao_Paulo
      COLLECTOR_TIMEZONE: America/Sao_Paulo
    volumes:
      - /mnt/Configs/Apps/orbit/data:/data
      - /mnt/Configs/Apps/orbit/config:/config:ro
      - /mnt/Files/Backups/orbit:/backups
```

Como a imagem é privada, faça login no GHCR antes em **Apps → Configuration → Sign-in to a Docker registry**:

- Tipo **Other Registry**, URI `https://ghcr.io`.
- Seu usuário do GitHub e um token clássico **somente** com `read:packages`.

Faça isso direto na tela do TrueNAS, nunca em chat ou arquivo versionado.

O TrueNAS chama o contêiner de `ix-orbit-orbit-1`. Os comandos abaixo usam esse nome.

### 4. Conferir

- App em **Running** e saúde **healthy** na tela do app.
- Página **Status** do Orbit: "Worker: Online".
- Logs esperados: `Orbit: http://0.0.0.0:3000` e `Worker Orbit pronto`.

## Variáveis

Vão em `environment:` no YAML, exceto as `AI_*`, que ficam em `orbit.env`.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `TZ` | `America/Sao_Paulo` no Compose | Horários na interface e nos logs |
| `COLLECTOR_TIMEZONE` | `TZ` | Fuso da agenda |
| `SCHEDULER_ENABLED` | `true` | Agenda automática |
| `COLLECTOR_CRON` | `0 8,14,20 * * *` | Horários das coletas |
| `COLLECTOR_MAX_RUNS_PER_DAY` | `6` | Limite automático em 24 h (1–12) |
| `COLLECTOR_MAX_ITEMS` | `20` | Itens por fonte e execução (1–50) |
| `ORBIT_DB_PATH` | `/data/orbit.db` | Não altere no contêiner |
| `ORBIT_ENV_FILE` | `/config/orbit.env` | Arquivo das variáveis `AI_*` |
| `ORBIT_BACKUP_DIR` | `/backups` | Destino de `scripts/backup.ts` |

## Backup

O Orbit grava em WAL. Copiar só o `orbit.db` com o app rodando pode perder as últimas escritas. Use uma destas formas:

1. **Backup online verificado (recomendado).** Usa a API de backup do SQLite, roda com o app ligado e grava um arquivo único `orbit-AAAAMMDD-HHMMSS.db` (horário UTC). Antes de salvar, confere a cópia com `integrity_check`.

   ```bash
   docker exec ix-orbit-orbit-1 node --import tsx scripts/backup.ts
   ```

   Para automatizar, crie em **System → Advanced Settings → Cron Jobs**, usuário `root`, diário às 03:30:

   ```bash
   docker exec ix-orbit-orbit-1 node --import tsx scripts/backup.ts && find /mnt/Files/Backups/orbit -name 'orbit-*.db' -mtime +14 -delete
   ```

2. **Snapshot ZFS** de `Configs/Apps/orbit` (**Data Protection → Periodic Snapshot Tasks**). O snapshot é atômico e pega `orbit.db`, `-wal` e `-shm` juntos, então o SQLite se recupera como após uma queda de energia. É bom como segunda camada, mas fica no mesmo disco. Os backups do item 1 vão para o raidz1.

O `orbit.env` contém a chave da IA e não entra no backup do banco. Guarde uma cópia dele à parte, num local protegido.

## Restauração

1. **Apps → orbit → Stop.**
2. No Shell do TrueNAS:

   ```bash
   cd /mnt/Configs/Apps/orbit/data
   mkdir -p ../antes-da-restauracao && mv orbit.db orbit.db-wal orbit.db-shm ../antes-da-restauracao/ 2>/dev/null
   install -o 568 -g 568 -m 600 /mnt/Files/Backups/orbit/orbit-AAAAMMDD-HHMMSS.db orbit.db
   ```

3. **Start.** As migrações rodam ao iniciar. Confira **Status** e as recomendações.

Mova os arquivos `-wal`/`-shm` antigos junto com o banco. Um WAL antigo ao lado de um banco restaurado corrompe a restauração.

## Atualização

1. Faça um backup (item 1 acima).
2. No YAML do app, troque a tag da imagem para a nova versão (`0.2.1`, ou `sha-<commit>` para fixar um build exato). Evite `latest`: dificulta saber o que está rodando e voltar atrás.
3. **Update/Save.** O TrueNAS recria o contêiner. O worker antigo libera o lease ao receber SIGTERM, e o novo aplica as migrações pendentes uma única vez antes de iniciar interface e worker.

Uma coleta em andamento durante a atualização é marcada como interrompida e repetida pelo novo worker, sem duplicar itens. Se o processo morrer sem SIGTERM, o novo worker espera até 60 s o lease antigo vencer.

### Limites do rollback

As migrações só andam para frente. Voltar a imagem depois que uma versão nova migrou o banco pode falhar ou corromper dados, porque o código antigo não conhece o esquema novo. Para voltar:

1. Pare o app.
2. Restaure o backup feito **antes** da atualização.
3. Volte a tag anterior.

O que foi coletado depois da atualização se perde nessa volta.

## Teste local (sem NAS)

```bash
docker compose up -d --build        # usa volumes nomeados orbit-data, orbit-config, orbit-backups
curl http://127.0.0.1:30480/api/health
docker compose logs -f
docker compose down                 # mantém os volumes; `down -v` apaga os dados
```

Para usar IA no teste, copie um `orbit.env` para o volume `orbit-config`. Nunca coloque o `.env` do repositório na imagem: o `.dockerignore` exclui `.env*`, bancos e perfis.

## Diagnóstico

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Log: "Não foi possível abrir o banco em /data/orbit.db (UID 568)" | Pasta inexistente ou com outro dono | Refaça o passo 1 de "Pastas e permissões" e confira `ls -ln /mnt/Configs/Apps/orbit` |
| App fica reiniciando | Erro na inicialização (permissão ou porta) | Veja os logs do app no TrueNAS |
| Saúde `unhealthy` / Status "Sem sinal recente" | Worker parado ou esperando lease antigo (até 60 s) | Aguarde 1 min; se persistir, veja os logs e reinicie o app |
| Status mostra erro de IA | `orbit.env` vazio, inválido ou ilegível | Confira dono e permissão 600; o diagnóstico nunca mostra a chave |
| Porta 30480 em uso | Outro app na mesma porta | Troque o lado esquerdo de `ports:` |

Comandos úteis:

```bash
docker logs --tail 100 ix-orbit-orbit-1
docker exec ix-orbit-orbit-1 node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
docker exec ix-orbit-orbit-1 node -e "const S=require('better-sqlite3');console.log(new S('/data/orbit.db',{readonly:true}).pragma('integrity_check',{simple:true}))"
```
