# Orbit no Docker e no TrueNAS

Um contêiner roda a interface, o worker e as migrações. O banco SQLite (modo WAL) fica num volume persistente; IA, contato Push e padrões de coleta/agenda podem ficar em arquivo separado, fora da imagem e do Compose.

## Versão 0.2.3

A versão `0.2.3` inclui leitura ampliada de `orbit.env`, diagnóstico, temas automáticos e briefings sob demanda. A publicação por tag depende da CI; não instala nem altera o NAS. Veja a [especificação](superpowers/specs/2026-10-28-briefings-push-themes-design.md).

Antes de atualizar um banco real, faça **backup online verificado anterior à consolidação de catálogo v2**. Downgrade à imagem `0.2.2` exige restaurar esse backup; trocar apenas a tag não reverte o banco.

O acesso é sempre protegido por senha e código TOTP. Fora de `localhost`, o login só acontece por HTTPS, através de um proxy reverso escolhido por você.

## Correção de conexão na versão 0.2.2

`AI_BASE_URL` aceita HTTP e HTTPS, inclusive IP da LAN ou nome de serviço Docker, sem flag adicional. A tag estável `v0.2.2` publica `0.2.2` e `latest` no destino privado existente, após a CI concluir. Esta correção não altera banco, extensão nem a exigência de HTTPS para login. Instalar/atualizar o app no NAS continua sendo uma ação separada.

## Evolução editorial desde a versão 0.2.1

A versão `0.2.1` inclui temas controlados, briefings gerais 08h/16h e Web Push. A publicação foi autorizada pelo usuário para o destino privado existente; considere a imagem disponível somente depois da CI da tag `v0.2.1` concluir todas as verificações. A imagem anterior `0.2.0` não contém esses recursos. Instalação e alterações no TrueNAS continuam exigindo autorização própria.

Antes de atualizar para esta versão, faça backup online verificado antes da migração de temas. O banco passa a incluir auditorias, arquivo de edições, inscrições push e chave privada VAPID: trate SQLite e backups como segredos. As migrações são locais, sem reclassificação paga; detalhes em [taxonomy.md](taxonomy.md).

Briefings gerais usam o fuso salvo em Configurações ou o `COLLECTOR_TIMEZONE` explícito, com fechamentos 08h e 16h. Coletam somente RSS públicos no servidor, sem extensão. Sem fuso configurado, a interface propõe `America/Sao_Paulo` e pede confirmação. Guia: [briefings.md](briefings.md).

Para Web Push, forneça **`ORBIT_PUSH_SUBJECT`** (contato `mailto:` ou HTTPS público válido) em `/config/orbit.env` ou no ambiente do contêiner. O contato não vazio do arquivo prevalece e vale na próxima leitura; mudar o ambiente exige recriar o contêiner. Com ambos vazios, Push fica desativado. Nenhuma chave privada vai no YAML: VAPID é gerada uma vez no banco. É necessária saída DNS e HTTPS/443 para os serviços de Push, sem nova porta de entrada. Em HTTPS, ative por clique em cada aparelho e teste. Helium/ungoogled-chromium geralmente não recebem Push; o diagnóstico orienta usar navegador compatível. Android/iOS têm limites próprios; veja [push.md](push.md) e seu roteiro físico, ainda pendente.

## Visão geral

| Item | Valor |
| --- | --- |
| Imagem | `ghcr.io/pedrorbc/orbit:<versão>` ou `:sha-<commit>` (veja "Imagem no GHCR"). Teste local: `docker compose up -d --build` |
| Porta interna | `3000` (HTTP). O Compose publica em `30480` por padrão (`ORBIT_PORT`) |
| Usuário | `568:568` (usuário `apps` do TrueNAS), sem root, sem capabilities, raiz somente leitura |
| `/data` | Banco `orbit.db` com `-wal`/`-shm`. Gravável pelo UID do contêiner, modo 700 |
| `/config` | `orbit.env` com `AI_*` e as seis chaves não-IA permitidas na tabela abaixo. Somente leitura, arquivo 600 |
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

### 2. Configuração do arquivo

Edite `/mnt/Configs/Apps/orbit/config/orbit.env` no Shell do TrueNAS (`nano`). Site e worker compartilham `readEnvironment`; `readAIEnvironment` continua como interface compatível. O arquivo é relido a cada leitura/ciclo, sem alterar `process.env` ou a autenticação de ferramentas externas. Use os nomes do `.env.example`: `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_BRIEFING_MODEL`, preços e limites. Também aceita `ORBIT_PUSH_SUBJECT`, `COLLECTOR_CRON`, `COLLECTOR_TIMEZONE`, `COLLECTOR_MAX_RUNS_PER_DAY`, `COLLECTOR_MAX_ITEMS` e `SCHEDULER_ENABLED`. O Orbit não escolhe fornecedor/modelo nem cadastra fontes/interesses por você.

Regras de leitura e precedência:

- `ORBIT_ENV_FILE=/config/orbit.env` seleciona só esse arquivo. Sem a variável, usa `.env` e depois `.env.local` (o segundo vence); com `ORBIT_ENV_FILE=""`, não lê arquivo.
- Se algum arquivo candidato existir, **todos os `AI_*` do ambiente são ignorados**, mesmo que uma chave esteja ausente/vazia no arquivo. Arquivo ilegível ou diretório deixa os `AI_*` ausentes, sem fallback para o ambiente. Arquivo ausente permite usar ambiente.
- Nas seis chaves não-IA permitidas: **valor não vazio do arquivo → valor não vazio do ambiente → padrão**. Vazio conta como ausente, inclusive o contato vazio passado pelo Compose.
- Agenda salva pela interface prevalece sobre os padrões do arquivo/ambiente. Arquivo vale na próxima leitura; mudança no ambiente do contêiner exige recriação. `SCHEDULER_ENABLED` só aceita `true`/`false`; limite automático inválido tem diagnóstico próprio.
- Hosts permitidos, portas, caminhos de inicialização e `TZ` continuam só no ambiente. Não podem ser alterados por `orbit.env`.

A chave fica só nesse arquivo. Não a coloque no YAML: variáveis do Compose aparecem em `docker inspect` e na tela do app no TrueNAS. Com o arquivo vazio, o app abre e coleta, mas não analisa. **Configurações → Configuração reconhecida** (`/configuracoes#ia`) mostra arquivo, origem/estado, modelos e último sucesso, sem mostrar chave ou endereço do contato. `AI_MODEL` também é requisito do briefing; com teto USD, configure preços próprios de `AI_BRIEFING_MODEL`.

Para CliProxyApi OpenAI Compatible na rede do NAS, configure `AI_PROTOCOL=openai` e `AI_BASE_URL=http://192.168.1.3:8317/v1`, substituindo IP/porta pelo endereço real alcançável a partir do contêiner. Numa rede Docker compartilhada, o nome do serviço também funciona (ex.: `http://cliproxyapi:8317/v1`). Não exige flag extra. `localhost` dentro do contêiner aponta para o próprio Orbit, não para o NAS ou outro app. **HTTP envia chave e textos sem criptografia: use somente em rede confiável; prefira HTTPS fora dela.** Não inclua credenciais, query ou fragmento na URL; redirects continuam recusados. A interface/login e a extensão continuam exigindo HTTPS fora de localhost.

### 3. App personalizado

**Apps → Discover Apps → ⋮ → Install via YAML**, nome `orbit`:

```yaml
services:
  orbit:
    image: ghcr.io/pedrorbc/orbit:0.2.3
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
      # Contato VAPID; preencha aqui ou em orbit.env na versão 0.2.3.
      # Não use o exemplo como contato real.
      ORBIT_PUSH_SUBJECT: mailto:seu-email@seu-dominio.com
    volumes:
      - /mnt/Configs/Apps/orbit/data:/data
      - /mnt/Configs/Apps/orbit/config:/config:ro
      - /mnt/Files/Backups/orbit:/backups
```

Se o pacote estiver público, não é necessário login para baixar a imagem. Se estiver privado, configure o GHCR em **Apps → Configuration → Sign-in to a Docker registry**:

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

O contêiner fala HTTP na porta publicada. Para usar no celular ou fora de casa, coloque um proxy reverso HTTPS na frente. Ele precisa cumprir cinco requisitos:

1. Termina TLS com certificado válido (necessário para login e instalação do PWA).
2. Repassa o `Host` público original, incluindo a porta quando houver; não reescreve para o IP interno.
3. Envia `X-Forwarded-Proto: https`.
4. Deixa `X-Forwarded-Host` **ausente ou igual ao host público**, incluindo a porta. Um host interno divergente pode fazer o Next recusar Server Actions, inclusive as de Push. Isso não autoriza relaxar Origin/CSRF.
5. O host público está em `ORBIT_ALLOWED_HOSTS` no ambiente do contêiner. Sem isso, hosts não locais recebem 403.

Exemplos:

- **Caddy** (`reverse_proxy`): testado de ponta a ponta com a imagem, incluindo login, Server Actions, recusa de outra origem e pareamento da extensão.
- **Tailscale Serve** (`tailscale serve --bg --https=8443 http://127.0.0.1:30480`, num nó com rede do host; acesso só pelo tailnet): preserva o `Host` e envia `X-Forwarded-Proto: https`, conforme o código do Tailscale. Não foi testado aqui.
- **Nginx Proxy Manager** (proxy host para `http://<IP do NAS>:30480`): não foi testado aqui. Confira `Host`, `X-Forwarded-Proto` e `X-Forwarded-Host` conforme os requisitos acima.

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

A tabela descreve a versão `0.2.3`, com leitura ampliada de `orbit.env`. Os demais valores vão em `environment:` do YAML quando não estiverem no arquivo permitido. Nunca coloque chave de IA no YAML.

| Variável | Padrão | Pode ir no orbit.env | Uso |
| --- | --- | --- | --- |
| `AI_*` | URL/chave/modelos ausentes | Sim | Protocolo, endpoint, chave, modelos, preços e limites; use `.env.example` |
| `ORBIT_PUSH_SUBJECT` | vazio | Sim | Contato VAPID `mailto:` ou HTTPS público; ausente/inválido bloqueia envio, sem revelar o endereço |
| `COLLECTOR_TIMEZONE` | fuso do sistema; Compose fornece `America/Sao_Paulo` | Sim | Fuso da coleta e herança explícita dos briefings gerais |
| `SCHEDULER_ENABLED` | `true` | Sim | Padrão da agenda pessoal, aceita só `true`/`false` |
| `COLLECTOR_CRON` | `0 8,14,20 * * *` | Sim | Horários das coletas pessoais |
| `COLLECTOR_MAX_RUNS_PER_DAY` | `6` | Sim | Limite de coletas automáticas em 24 h (1–12) |
| `COLLECTOR_MAX_ITEMS` | `20` | Sim | Itens por fonte/execução (1–50) |
| `ORBIT_ALLOWED_HOSTS` | vazio | Não | Hosts adicionais exatos, com porta se houver (ex.: `orbit.seudominio.com,nas.tailnet.ts.net:8443`) |
| `PORT` | `3000` | Não | Porta interna; o Compose publica `30480` por padrão (`ORBIT_PORT`) |
| `ORBIT_HOST` | `0.0.0.0` na imagem | Não | Interface de escuta; desenvolvimento usa `127.0.0.1` |
| `ORBIT_DB_PATH` | `/data/orbit.db` na imagem | Não | Caminho SQLite; não altere no contêiner |
| `ORBIT_ENV_FILE` | `/config/orbit.env` na imagem | Não | Seleciona arquivo do leitor; vazio desativa leitura |
| `ORBIT_BACKUP_DIR` | `/backups` na imagem | Não | Destino de `scripts/backup.ts` |
| `TZ` | `America/Sao_Paulo` no Compose | Não | Fuso do processo, usado quando não há fuso explícito |

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

1. Faça um **backup online verificado antes da atualização** (item 1 acima) e guarde também a configuração em local protegido. A v2 do catálogo tem marcador/transação próprios além das migrations; depois dela, voltar à `0.2.2` exige esse backup anterior.
2. No YAML do app, troque a tag da imagem para a nova versão (`0.2.3`, ou `sha-<commit curto>` para fixar um build exato). Evite `latest`: dificulta saber o que está rodando e voltar atrás.
3. **Update/Save.** O TrueNAS recria o contêiner. O worker antigo libera o lease ao receber SIGTERM, e o novo aplica as migrações pendentes uma única vez antes de iniciar interface e worker.

Uma coleta em andamento durante a atualização é marcada como interrompida e repetida pelo novo worker, sem duplicar itens. Se o processo morrer sem SIGTERM, o novo worker espera até 60 s o lease antigo vencer.

### Limites do rollback

As migrações só andam para frente. **Depois da consolidação de catálogo v2, voltar à imagem `0.2.2` exige restauração do backup anterior**. Trocar só a imagem não reverte temas, aliases, propostas ou auditorias e não é um rollback suportado. Isso vale mesmo sem novo arquivo SQL Drizzle. Para voltar:

1. Pare o app.
2. Restaure o backup feito **antes** da atualização.
3. Volte a tag anterior.

O que foi coletado depois da atualização se perde nessa volta.

## Imagem no GHCR

O repositório GitHub é público; o pacote GHCR pode ser público ou privado. Visibilidade controla quem pode baixar a imagem, não quem pode publicar versões. O workflow `.github/workflows/ci.yml` roda testes, typecheck, build e e2e em PRs, pushes na `main` e tags `v*`. Um push de branch isolado não dispara CI. PRs, inclusive de forks, só executam validação, sem permissão de publicar.

A publicação exige o repositório oficial `PedroRBC/orbit` (ID `1436259756`), um push da conta `PedroRBC` (ID `58788062`) e a mesma conta como solicitante da execução ou reexecução. Forks, outras contas e bots não publicam a imagem oficial pelo workflow. Os checkouts não persistem credenciais; o token tem `contents: read` e somente o job de imagem recebe `packages: write`. Não há permissão `contents: write` nem criação automática de GitHub Releases.

Com os testes aprovados e a identidade validada, a imagem é publicada (`linux/amd64`) nos seguintes eventos:

| Evento | Tags publicadas |
| --- | --- |
| Push em `main` (após merge) | `<versão do package.json>`, `sha-<commit curto>`, `latest` |
| Tag `v*` estável empurrada (ex.: `v0.2.1`) | `<versão da tag>`, `sha-<commit curto>`, `latest` |
| Tag `v*` de candidato (ex.: `v0.2.0-rc.1`) | `<versão da tag>` (ex.: `0.2.0-rc.1`), `sha-<commit curto>` |

Use a versão ou o `sha-` no TrueNAS, nunca só `latest`. O `sha-` identifica exatamente o commit; a imagem também traz os labels `org.opencontainers.image.version` e `.revision`.

O YAML deste guia fixa `0.2.3`. Consulte o [pacote no GHCR](https://github.com/users/PedroRBC/packages/container/package/orbit). Se público, o download não exige autenticação; se privado, exige acesso ao pacote. A CI não altera a visibilidade. A CI da tag precisa concluir antes de instalar.

Todo lançamento estável por tag (ex.: `v0.2.1`) publica `ghcr.io/pedrorbc/orbit:<versão>`, `:sha-<commit curto>` e move `latest` para ele; candidatos com `-` (ex.: `-rc.1`) nunca recebem `latest`. Push na main também move `latest`. Para uma atualização controlada no NAS, mantenha a versão fixa ou copie o digest do resumo da [publicação aprovada](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml):

```text
ghcr.io/pedrorbc/orbit@sha256:<digest publicado>
```

O digest anterior do candidato `0.2.0-rc.2` não identifica a versão oficial. O [registro de validação](validation-self-hosted.md) preserva essa evidência histórica e distingue testes executados de verificações pendentes no NAS/celular.

O CI confirma o ID do repositório oficial antes de publicar e aceita pacote público ou privado. Depois, confere tags e digest pela API e pelo registry e apenas informa a visibilidade encontrada, sem exigir `private`. A evidência aparece no resumo da [execução de publicação](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml). Se a consulta falhar, a execução falha em vez de declarar publicação verificada.

### Controle de releases no GitHub

Em 30/10/2026 foram ativados dois rulesets no repositório oficial:

- [Orbit: owner-only main](https://github.com/PedroRBC/orbit/rules/26207761): somente administradores podem criar, atualizar ou excluir `main`.
- [Orbit: owner-only tags](https://github.com/PedroRBC/orbit/rules/26207762): somente administradores podem criar, atualizar ou excluir qualquer tag.

Somente `PedroRBC` tem acesso de escrita/administração no momento da configuração. Os rulesets usam bypass para o papel **Admin**, não uma lista individual; conceder administração a outra conta também concede esse bypass. As regras são configurações do GitHub, não acompanham forks e precisam ser recriadas se o repositório for migrado.

Para manter releases exclusivas, não conceda **Write**, **Maintain** ou **Admin** a outras contas, apps ou chaves. Permissão de escrita pode criar/editar uma GitHub Release para uma tag existente ou introduzir outro workflow de publicação; a condição deste workflow não é uma ACL global. Contribuições externas devem chegar por fork/PR, revisadas e integradas por `PedroRBC`. A conta proprietária e seus tokens continuam sendo a fronteira de confiança.

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
| Status mostra erro de IA | `orbit.env` vazio, inválido ou ilegível, modelo/preço ausente | Abra `/configuracoes#ia`, confira origem e motivo, dono e permissão 600; o diagnóstico nunca mostra a chave |
| Push desativado ou `AbortError` | Contato ausente/inválido ou navegador sem serviço Push | Confira o estado do contato; no Helium/ungoogled-chromium, tente navegador compatível ou celular; veja `push.md` |
| Server Action/Push falha atrás do proxy | `X-Forwarded-Host` interno diferente do `Host` público | Remova o cabeçalho ou iguale ao host público com porta, sem relaxar Origin/HTTPS/CSRF |
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
