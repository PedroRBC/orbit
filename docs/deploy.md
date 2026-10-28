# Orbit no Docker e no TrueNAS

Um contêiner roda a interface, o worker e as migrações. O banco SQLite (modo WAL) fica num volume persistente; a configuração de IA fica num arquivo separado, fora da imagem e fora do Compose.

O acesso é sempre protegido por senha e código TOTP. Fora de `localhost`, o login só acontece por HTTPS, através de um proxy reverso escolhido por você.

## Visão geral

| Item | Valor |
| --- | --- |
| Imagem | `ghcr.io/pedrorbc/orbit:<versão>` ou `:sha-<commit>` (privada; veja "Imagem no GHCR"). Teste local: `docker compose up -d --build` |
| Porta interna | `3000` (HTTP). O Compose publica em `30480` por padrão (`ORBIT_PORT`) |
| Usuário | `568:568` (usuário `apps` do TrueNAS), sem root, sem capabilities, raiz somente leitura |
| `/data` | Banco `orbit.db` com `-wal`/`-shm`. Gravável pelo UID do contêiner, modo 700 |
| `/config` | `orbit.env` com as variáveis `AI_*`. Somente leitura, arquivo 600 |
| `/backups` | Cópias verificadas do banco |
| Saúde | `GET /api/health`: 200 com interface e worker vivos; 503 se o worker parou de sinalizar. O `HEALTHCHECK` da imagem usa essa rota |

A coleta pessoal (YouTube home, X, Instagram, Valete+) depende da extensão no navegador do seu computador, que conversa com o Orbit pela API no mesmo endereço HTTPS da interface. Com o computador desligado, o Orbit continua mostrando os dados já coletados e segue com RSS e IA. As fontes pessoais ficam com o aviso "navegador indisponível" até a extensão voltar; o NAS nunca recebe cookies nem sessões das plataformas.

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
      # Endereços pelos quais você abre o Orbit, separados por vírgula.
      ORBIT_ALLOWED_HOSTS: orbit.seudominio.com
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

### 4. Primeiro acesso

No Shell do TrueNAS:

```bash
docker exec -it ix-orbit-orbit-1 npm run auth -- setup
```

O comando pede uma senha (mínimo 12 caracteres, digitada sem eco), mostra a chave TOTP para cadastrar no app autenticador do celular, confere um código e exibe oito códigos de recuperação. Guarde esses códigos fora do NAS. Nada disso vai para os logs do contêiner. Rodar `setup` de novo troca senha e autenticador e encerra todas as sessões; `npm run auth -- logout-all` só encerra as sessões; `npm run auth -- unlock` só remove bloqueios de tentativas.

### 5. Conferir

- App em **Running** e saúde **healthy** na tela do app.
- Logs esperados: `Orbit: http://0.0.0.0:3000` e `Worker Orbit pronto`. Enquanto o acesso não existir, aparece "Acesso ainda não configurado".
- Pelo endereço HTTPS: tela **Entrar no Orbit**; depois do login, **Status** mostra "Worker: Online".

## Acesso remoto e HTTPS

O contêiner fala HTTP na porta publicada. Para usar no celular ou fora de casa, coloque um proxy reverso HTTPS na frente. Qualquer um serve se cumprir quatro requisitos:

1. Termina TLS com certificado válido (necessário para login e para instalar o PWA).
2. Repassa o `Host` original (não reescreve para o IP interno).
3. Envia `X-Forwarded-Proto: https`.
4. Esse host está em `ORBIT_ALLOWED_HOSTS`. Sem isso, o Orbit responde 403 a qualquer Host que não seja `localhost`.

Exemplos:

- **Caddy** (`reverse_proxy`): testado de ponta a ponta com a imagem, incluindo login, Server Actions, recusa de outra origem e pareamento da extensão.
- **Tailscale Serve** (`tailscale serve --bg --https=8443 http://127.0.0.1:30480`, num nó com rede do host; acesso só pelo tailnet): preserva o `Host` e envia `X-Forwarded-Proto: https`, conforme o código do Tailscale. Não foi testado aqui.
- **Nginx Proxy Manager** (proxy host para `http://<IP do NAS>:30480`): não foi testado aqui. Confira se o `Host` e o `X-Forwarded-Proto` chegam como descrito acima.

Rede, DNS, certificados e roteador ficam por sua conta.

- Abrir `http://<IP do NAS>:30480` direto mostra o login com o aviso "Abra o Orbit pelo endereço HTTPS" (e só se o IP estiver em `ORBIT_ALLOWED_HOSTS`). Senha e código nunca são aceitos por HTTP fora de localhost.
- A porta 30480 não precisa estar aberta na internet: só o proxy precisa alcançá-la. Se o proxy roda no próprio NAS, você pode publicar só em loopback (`"127.0.0.1:30480:3000"`) quando o proxy usar rede do host.
- Cinco erros de senha/código bloqueiam aquele cliente por 15 minutos. O cliente é o último endereço do `X-Forwarded-For`, isto é, o que o seu proxy acrescenta; sem esse cabeçalho, todos contam como um só. Não há bloqueio global, para ninguém conseguir trancar você fora. Se publicar na internet, configure também limite de requisições no proxy (ex.: em `/login`). `npm run auth -- unlock` remove os bloqueios.
- A porta publicada deve ficar acessível só ao proxy (firewall, rede interna do Docker, ou `127.0.0.1:` quando o proxy usa a rede do host). Um cliente que fale direto com ela pode forjar `X-Forwarded-Proto`; isso não expõe sua senha, mas tira do proxy o controle de quem chega ao app.

## App no celular (PWA)

O Orbit pode ser instalado na tela inicial e abre em tela cheia, sem barra do navegador. Requisito: abrir pelo endereço **HTTPS** (certificado válido); por HTTP ou com certificado inválido o navegador não oferece a instalação.

- **Android (Chrome):** abra o endereço, entre com senha e código, toque em **⋮ → Instalar app** (ou **Adicionar à tela inicial**) e confirme.
- **iPhone/iPad (Safari):** abra o endereço, entre, toque em **Compartilhar → Adicionar à Tela de Início** e confirme o nome "Orbit". No iOS o app instalado tem cookies próprios: entre de novo dentro dele uma vez.

A sessão dura 30 dias. Sem conexão com o servidor (internet, VPN ou Tailscale desligados), o app mostra "Sem conexão com o Orbit" no topo ou uma página offline ao abrir. O service worker guarda **só** essa página estática: recomendações, perfil, sessões e ações nunca ficam no aparelho, e nada que você tocar sem conexão é reenviado depois.

## Extensão no computador

1. Entre no Orbit pelo endereço HTTPS, abra **Conectar navegador** e baixe a extensão (`orbit-extensao-<versão>.zip`).
2. No Helium: `chrome://extensions` → Modo de desenvolvedor → **Carregar sem compactação** → pasta `orbit-extensao`.
3. Gere o código em **Conectar navegador**, informe o endereço HTTPS mostrado na tela no popup da extensão e permita o acesso quando o Helium pedir.

Ao atualizar o Orbit, baixe a extensão de novo, substitua os arquivos da pasta e clique em **Recarregar**. O pareamento é preservado; a tela avisa quando a versão instalada está desatualizada.

## Variáveis

Vão em `environment:` no YAML, exceto as `AI_*`, que ficam em `orbit.env`.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `ORBIT_ALLOWED_HOSTS` | vazio | Hosts aceitos além de localhost (ex.: `orbit.seudominio.com,nas.tailnet.ts.net:8443`) |
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
2. No YAML do app, troque a tag da imagem para a nova versão (`0.2.1`, ou `sha-<commit curto>` para fixar um build exato). Evite `latest`: dificulta saber o que está rodando e voltar atrás.
3. **Update/Save.** O TrueNAS recria o contêiner. O worker antigo libera o lease ao receber SIGTERM, e o novo aplica as migrações pendentes uma única vez antes de iniciar interface e worker.

Uma coleta em andamento durante a atualização é marcada como interrompida e repetida pelo novo worker, sem duplicar itens. Se o processo morrer sem SIGTERM, o novo worker espera até 60 s o lease antigo vencer.

### Limites do rollback

As migrações só andam para frente. Voltar a imagem depois que uma versão nova migrou o banco pode falhar ou corromper dados, porque o código antigo não conhece o esquema novo. Para voltar:

1. Pare o app.
2. Restaure o backup feito **antes** da atualização.
3. Volte a tag anterior.

O que foi coletado depois da atualização se perde nessa volta.

## Imagem no GHCR

O workflow `.github/workflows/ci.yml` roda testes, typecheck, build e e2e em todo PR e push. A imagem só é publicada (privada, `linux/amd64`) em dois casos:

| Evento | Tags publicadas |
| --- | --- |
| Push em `main` (após merge) | `<versão do package.json>`, `sha-<commit curto>`, `latest` |
| Tag `v*` empurrada (ex.: `v0.2.0-rc.1`) | `<versão da tag>` (ex.: `0.2.0-rc.1`), `sha-<commit curto>` |

Use a versão ou o `sha-` no TrueNAS, nunca só `latest`. O `sha-` identifica exatamente o commit; a imagem também traz os labels `org.opencontainers.image.version` e `.revision`.

O YAML deste guia usa a versão oficial `0.2.0`. O [pacote é privado](https://github.com/users/PedroRBC/packages/container/package/orbit); acessar o link e baixar a imagem exigem autenticação.

A publicação da `main` produz `ghcr.io/pedrorbc/orbit:0.2.0`, `:latest` e `:sha-<commit curto>`, todas apontando para o mesmo digest daquela execução. `latest` acompanha a publicação mais recente: para uma atualização controlada no NAS, mantenha a versão fixa ou copie o digest do resumo da [publicação aprovada](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml?query=branch%3Amain):

```text
ghcr.io/pedrorbc/orbit@sha256:<digest publicado>
```

O digest anterior do candidato `0.2.0-rc.2` não identifica a versão oficial. O [registro de validação](validation-self-hosted.md) preserva essa evidência histórica e distingue testes executados de verificações pendentes no NAS/celular.

O CI verifica que o repositório e um pacote já existente são privados **antes** de publicar. Depois, consulta a API de pacotes para exigir `visibility: private` e confere que as tags de versão e SHA apontam para o digest publicado. A evidência aparece no resumo da [execução de publicação](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml). Se a consulta falhar, a execução falha em vez de declarar publicação verificada.

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
| "Host não permitido" (403) | Endereço fora de `ORBIT_ALLOWED_HOSTS` ou proxy reescrevendo o Host | Inclua o host exato (com porta, se não for 443) e confira se o proxy preserva o `Host` |
| Login diz "Abra o Orbit pelo endereço HTTPS" | Acesso por HTTP ou proxy sem `X-Forwarded-Proto: https` | Use o endereço HTTPS; ajuste o proxy |
| "Acesso ainda não configurado" | Primeiro uso | Rode o `setup` do passo 4 |
| Perdeu o autenticador | — | Entre com um código de recuperação ou rode o `setup` de novo pelo Shell do TrueNAS |
| "Muitas tentativas" | 5 erros seguidos do mesmo endereço | Aguarde 15 min ou rode `docker exec ix-orbit-orbit-1 npm run auth -- unlock` |
| Extensão "Sem permissão para acessar o endereço" | Permissão negada no Helium | Conecte de novo e permita o acesso ao host do Orbit |

Comandos úteis:

```bash
docker logs --tail 100 ix-orbit-orbit-1
docker exec ix-orbit-orbit-1 node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
docker exec ix-orbit-orbit-1 node -e "const S=require('better-sqlite3');console.log(new S('/data/orbit.db',{readonly:true}).pragma('integrity_check',{simple:true}))"
```
