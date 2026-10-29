# Briefings pessoais, gerais e sob demanda

A evolução de briefings sob demanda e RSS no briefing pessoal está **em desenvolvimento, não publicada**, sobre a base `0.2.2`. Versão e imagem padrão não mudam nesta etapa. Escopo: [especificação aprovada](superpowers/specs/2026-10-28-briefings-push-themes-design.md).

## Origem e separação

- **Briefing geral** (`/briefings`): RSS públicos cadastrados por você. Coleta no servidor, sem Helium, extensão, cookies de plataformas ou perfil pessoal. A abrangência depende das fontes; não é uma varredura de todo o noticiário.
- **Briefing pessoal** (Hoje): até oito itens pessoais classificados, com até três notícias RSS externas como complemento secundário identificado. Sem item pessoal elegível, não há briefing pessoal; consulte `/briefings` ou Fora da bolha. As recomendações **Vale a pena ver** continuam excluindo `news`.
- **Fora da bolha**: até três RSS externos com publicação comprovada nas últimas 48 h, sem datas futuras. Exclui notícias citadas no briefing pessoal mais recente antes do limite SQL e busca diversidade. Sem análise, mostra manchete/trecho original, não nota inventada.

Nenhum portal, canal, interesse ou conteúdo de demonstração é presumido.

## Configuração reconhecida

1. Em **Fontes → Notícias externas**, cadastre até dez feeds RSS/Atom públicos HTTPS da sua confiança. O transporte valida DNS/IP público, pina a conexão e preserva TLS/SNI; revalida redirects. Não aceita credenciais ou destinos privados.
2. No servidor, configure protocolo, URL, chave, **`AI_MODEL`** e **`AI_BRIEFING_MODEL`** explicitamente. Sem classificação configurada, o briefing também está incompleto. Com teto em USD, os preços próprios de entrada/saída do modelo de briefing são obrigatórios. Não há troca automática de fornecedor/modelo.
3. Em **Configurações → Configuração reconhecida** (`/configuracoes#ia`), confira arquivo/origem, modelos, motivos de configuração incompleta e último sucesso. O painel não revela chave ou endereço de contato.
4. Em **Configurações → Briefings gerais**, confirme o fuso IANA e ative a agenda para os horários **08h e 16h no fuso exibido**. A agenda pessoal é independente.
5. Para Push, configure `ORBIT_PUSH_SUBJECT` no arquivo do servidor ou no ambiente dos processos e siga [Web Push](push.md).

No Docker, o leitor usa `/config/orbit.env`. Além de `AI_*`, aceita `ORBIT_PUSH_SUBJECT`, `COLLECTOR_CRON`, `COLLECTOR_TIMEZONE`, `COLLECTOR_MAX_RUNS_PER_DAY`, `COLLECTOR_MAX_ITEMS` e `SCHEDULER_ENABLED`. Arquivo não vazio prevalece sobre ambiente para essas seis chaves; `AI_*` do ambiente são ignorados integralmente se algum arquivo candidato existir. Arquivo ilegível deixa os `AI_*` ausentes, sem fallback. Valores de arquivo valem na próxima leitura; ambiente do contêiner exige recriação. Detalhes na [tabela de variáveis](deploy.md#variáveis).

O fuso geral usa a configuração própria salva na interface; antes dela, o fuso explícito da agenda de coleta ou `COLLECTOR_TIMEZONE`. Sem ambos, propõe **America/Sao_Paulo**, desativado até confirmação. O Compose já fornece esse fuso explicitamente. Pausar coleta pessoal não pausa a agenda geral; pausar agenda geral não impede pedido sob demanda com fuso confirmado.

## Atualizar briefing pessoal

O botão **Atualizar briefing pessoal**, no card da Home, enfileira `collector_runs.kind = 'briefing'`, `trigger = 'manual'`. **Não coleta fontes nem aciona a extensão**: classifica pendências elegíveis do banco e gera/reutiliza o briefing. Sem interesses ou configuração completa, recusa antes de enfileirar; o worker também verifica a configuração antes da classificação.

A seleção pessoal usa fontes ativas, itens analisados sem spam e coleta nas últimas 24 h. As externas exigem `platform = 'news'`, `evidence = 'news_rss'`, análise sem spam, fonte ativa e `newsPublishedAt` comprovado entre agora e 24 h atrás. Até trinta candidatas externas são ordenadas por nota/data, deduplicadas por manchete e selecionadas com preferência por fontes diferentes, até três. Não recebem pesos pessoais.

Pessoais têm prioridade no orçamento. Cada notícia vai com `external: true`, data comprovada e descrição limitada a **1.500 caracteres**. O modelo pode omitir externas irrelevantes ou de assuntos excluídos; cada ID externo pode ser citado no máximo uma vez. Todos os IDs pessoais enviados precisam aparecer exatamente uma vez, em até oito tópicos. Uma externa só se junta a tópico pessoal quando trata do mesmo fato concreto, com atribuição por fonte; caso contrário pode ter tópico próprio. Links/autores vêm do banco, nunca da IA.

O card distingue pessoais/externos e marca tópicos com **Inclui fonte externa**. Havendo externas citadas, mostra: **Inclui notícias externas de RSS como complemento; elas não vêm do seu algoritmo.** Sem externas, o motivo é calculado e persistido na geração: nenhum RSS ativo, nenhuma notícia com data comprovada nas últimas 24 h, notícias aguardando análise ou modelo não citou nenhuma. Não há chamada de IA na renderização.

O cache usa itens candidatos, preferências, pesos, protocolo, endpoint, modelo e prompt, **sem o dia UTC**. Snapshot idêntico reutiliza o briefing, mesmo em outro dia ou sem saldo. Aumentar apenas o teto não invalida o cache de uma seleção antes reduzida por orçamento. Falhas preservam a versão anterior e sua data. O dia continua no payload e o orçamento continua UTC. A classificação de pendências pode gastar tokens mesmo se a geração do briefing for reutilizada; o aviso de cache não deve ser entendido como isenção de toda a execução.

Notícias pendentes só são classificadas com publicação comprovada nas últimas **48 h**, sem datas futuras; pendências são ordenadas por coleta mais recente. Feedback em notícias é salvo, mas não gera novos ajustes nos pesos pessoais. Pesos antigos já afetados por RSS permanecem intactos.

## Gerar briefing geral agora

O botão **Gerar briefing geral agora** fica no destaque Brasil e mundo da Home e em `/briefings`. Exige configuração completa e fuso confirmado. Cria uma **Edição sob demanda** (`edition = 'manual'`, slot `manual:<fuso>:<ms>`), coleta somente RSS públicos habilitados e cobre as últimas **24 h até o pedido**.

Exclui IDs e manchetes já publicados em edições das últimas 24 h. Sem notícia datada nova, registra o motivo sem chamar a IA. Não aplica a expiração de atraso de duas horas das edições agendadas e **não envia Push**. Enquanto aguarda, o detalhe diz **Solicitada em**; publicada, diz **Gerada em**, sem confundir pedido com conclusão.

Os dois pedidos manuais usam o **mesmo orçamento diário UTC**, reservas e limites da classificação/briefings agendados, sem saldo extra. Cada tipo tem intervalo mínimo de **cinco minutos** e recusa outro pedido enquanto houver tarefa do mesmo tipo na fila/em andamento; na edição geral, isso inclui edição agendada ativa. As filas são independentes da fila de coleta, mas o worker executa tudo sequencialmente sob lease. O botão e Status mostram o andamento; não garantem conclusão ou gasto zero.

## Edições agendadas: cobertura e atualização

- **08h:** publicação comprovada nas 24 h anteriores ao fechamento; mantém panorama de 24 h mesmo se houve edição manual.
- **16h:** publicação desde 08h até o fechamento; exclui IDs e manchetes da manhã **e de edições manuais do mesmo dia/fuso**. O resumo da manhã é contexto, não prova de novidade.
- Cada edição mostra data, fuso, período coberto, fechamento programado e geração real. Atraso não estende a cobertura.
- A prova é `pubDate` original do RSS ou `published` original do Atom, persistido em `newsPublishedAt`. `updated`, `isoDate` sintetizada e `dc:date` genérico não provam publicação. Datas fora da janela ou futuras não entram; coletar agora não torna atual uma notícia antiga.
- Legados com `newsPublishedAt` nulo aguardam nova coleta que comprove a data, sem sobrescrever o `publishedAt` histórico ou mudar texto/cache/vínculos. O campo comprovado já preenchido não é avançado por republicação da mesma URL; não há comparação integral de versões de artigos.
- Até 200 notícias elegíveis são consultadas; a seleção deduplica manchetes e distribui até doze candidatas entre origens. O orçamento pode reduzir a amostra. A IA organiza de um a oito destaques, com resumo, contexto, relevância e IDs validados. Só título/trecho RSS é enviado, não reportagem integral ou mídia. Não há checagem factual externa.
- Falha de fonte é isolada e cooldown respeita `Retry-After`. Notícias datadas disponíveis podem fundamentar edição com aviso de fonte não atualizada. Sem novidades, IA ou saldo, fica registro indisponível/erro, não conteúdo inventado. Edições anteriores continuam acessíveis.

## Fila, reinício, atraso e Push

O scheduler geral calcula slots 08h/16h pelo fuso usando `Intl`, inclusive horário de verão, e verifica uma vez por minuto no laço do worker. A chave única `fuso:data-local:hora` impede duplicar um fechamento no reinício.

`collector_runs.kind = 'edition'` e `editionId` reutilizam a fila durável. Esses jobs não consomem a cota de **coletas pessoais** nem fazem uma coleta pessoal desaparecer no mesmo horário; a cota de coleta é separada, o orçamento de IA é compartilhado. IA só roda no worker. Erro inesperado de uma edição com lease válido a marca como `error`, não a deixa `running`; perda de lease não finaliza o trabalho de outro worker.

A recuperação automática considera apenas fechamento agendado vencido há **até duas horas**. Edição agendada que fica mais de duas horas na fila torna-se indisponível; não há backlog de dias perdidos. Não há retry contínuo; execução interrompida pode retomar até **duas tentativas persistidas por edição**. Chamada ambígua mantém sua reserva; retomada pode gastar de novo dentro do teto. A exceção ao limite de atraso é a edição manual, não a agenda automática.

Edição publicada não é gerada novamente. Para edições **agendadas**, publicação e outbox Push são atômicas sob lease; manual não cria aviso. Push tem tentativa única, sem retry ambíguo, podendo perder avisos em quedas. O contato pode estar em `orbit.env`; navegador/provedor precisam oferecer suporte. Operações do painel têm prazo de 30 s, exceto permissão, e não duplicam uma inscrição nativa pendente. Helium/ungoogled-chromium geralmente não recebem Push; use navegador compatível. Veja [push.md](push.md), inclusive roteiro Android ainda pendente.

Páginas, ações e links de notificação exigem sessão. O SW continua guardando **somente `/offline.html`**: o arquivo de edições fica no servidor, não como cache pessoal offline.

## Armazenamento, atualização e rollback

`editions` persiste slot, data/fuso, janela, estado/tentativas, conteúdo/IDs citados, modelo, avisos e tempos. Migrations `0008`/`0009` criam edições/Push; `0010` acrescenta a publicação comprovada. `kind = 'briefing'` e `edition = 'manual'` ampliam enums TypeScript em colunas TEXT já existentes, sem nova migração SQL. A consolidação de catálogo v2 tem transação/marcador próprios; veja [taxonomy.md](taxonomy.md).

**Faça backup online verificado antes de atualizar um banco real**, proteja SQLite/configuração/backups e conserve a versão anterior. Depois da v2, downgrade à `0.2.2` exige parar o app e restaurar o backup anterior antes de trocar a imagem; dados posteriores ao backup se perdem. A imagem padrão deste repositório continua `0.2.2` e não contém esta evolução. Esta etapa não publica, faz merge nem altera NAS/celular.

## Validação sem serviço pago

- Vitest cobre filas manuais, cinco minutos, fuso, agenda/reinício/lease, cache, orçamento, seleção/validação de RSS, feedback sem pesos e recuperação de erros.
- E2E de `editorial.spec.ts` e `orbit.spec.ts` cobre arquivo privado, controles, configuração incompleta, fontes externas, catálogo e layout desktop/móvel; `push.spec.ts` cobre prazos e reconciliação com APIs nativas simuladas.
- `worker-edition.test.ts` e `worker-briefing.test.ts` usam worker real com SQLite isolado e fronteiras de rede sintéticas. Não comprovam entrega Push, layout atual de plataformas ou implantação real.

```sh
ORBIT_ENV_FILE="" npm test
ORBIT_ENV_FILE="" npm run typecheck
ORBIT_ENV_FILE="" npm run check
ORBIT_ENV_FILE="" npm run build
ORBIT_ENV_FILE="" DOTENV_CONFIG_PATH=/dev/null npm run test:e2e
```

Fixtures só existem em testes. Sem API paga ou endpoint/chave real; testes físicos Android/NAS e entrega por provedor real continuam com o usuário.
