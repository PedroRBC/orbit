# Orbit

O Orbit reúne conteúdos do YouTube, X, Instagram, Valete+ e feeds RSS em um painel pessoal, com IA para filtrar, resumir e recomendar o que vale a pena acompanhar. Desenvolvido com TypeScript, Next.js, React e Tailwind CSS, usa SQLite com Drizzle ORM e um worker Node.js para coletas agendadas. Roda em servidor próprio via Docker e pode ser instalado no celular como PWA.

Curador pessoal de conteúdo, local e em português. **Cinco fases implementadas:** YouTube RSS/home, X Para você, Instagram, Valete+, recomendações de IA, briefing com fontes, feedback, perfil aprendido, Fora da bolha por RSS externo, agenda e controle de custo.

Não confunda o que seus feeds mostram com uma visão completa do mundo. O Orbit indica fontes e limites da análise.

## Versão 0.2.2 — CliProxyApi por HTTP

`AI_BASE_URL` agora aceita HTTP fora de localhost, inclusive IP da LAN e hostname de serviço Docker, sem flag adicional. Isso permite usar o CliProxyApi na rede do NAS. HTTP envia chave e textos sem criptografia: use apenas em rede confiável. Login, RSS e Web Push não mudam. A tag `v0.2.2` publica `0.2.2` e `latest` no GHCR privado, após CI aprovada, sem alterar o NAS ou fazer merge na main.

## Versão 0.2.3 — briefings, temas e Push

A versão `0.2.3` acrescenta configuração reconhecida, briefings sob demanda, RSS como complemento do briefing pessoal, temas automáticos e correções de Web Push. A tag `v0.2.3` publica `0.2.3` e `latest` após CI aprovada, sem alterar o NAS. Escopo aprovado: [especificação](docs/superpowers/specs/2026-10-28-briefings-push-themes-design.md) e [plano](docs/superpowers/plans/2026-10-28-briefings-push-themes.md).

- [Catálogo de temas e consolidação auditada](docs/taxonomy.md): oito sementes, novos temas após três itens pessoais distintos, até 40 temas e junção pela interface. Faça backup antes da migração v2; voltar à `0.2.2` exige restaurá-lo.
- [Briefings pessoais e gerais](docs/briefings.md): atualização pessoal sem coletar fontes, edição geral sob demanda e horários 08h/16h, com orçamento diário compartilhado.
- [Web Push e instalação por aparelho](docs/push.md): contato também em `orbit.env`, diagnóstico por aparelho, prazo de 30 segundos, limites do Helium e roteiro Android.

Em **Configurações → Briefings gerais**, confirme o fuso e ative os horários. Sem fuso explícito, a proposta é `America/Sao_Paulo`, sem ativação silenciosa. Até três notícias externas marcadas podem complementar o briefing pessoal; nunca entram em **Vale a pena ver**. O serviço continua privado, com login e um único usuário. Testes físicos no celular e no NAS continuam pendentes.

## Docker, TrueNAS e celular

O Orbit roda como um serviço em contêiner: interface, worker e migrações juntos, banco SQLite persistente e IA configurada fora da imagem. Pelo endereço HTTPS, ele pode ser instalado no celular como app (PWA). Instalação, volumes, acesso remoto, login, extensão, PWA no Android/iPhone, backup, atualização e diagnóstico estão em [docs/deploy.md](docs/deploy.md).

- [PR de implantação #2](https://github.com/PedroRBC/orbit/pull/2).
- [Pacote privado no GHCR](https://github.com/users/PedroRBC/packages/container/package/orbit): versão desta entrega `ghcr.io/pedrorbc/orbit:0.2.3`, publicada pela tag após CI aprovada, junto de `:sha-<commit curto>` e `:latest`. `latest` acompanha a main e tags estáveis; candidatos nunca. Este lançamento não faz merge na main.
- [Publicações da main](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml?query=branch%3Amain): cada execução confere privacidade, tags e digest; consulte a última publicação aprovada antes de instalar ou atualizar.
- [Registro de validação](docs/validation-self-hosted.md): testes executados e pendências no NAS/celular, incluindo a [publicação anterior do candidato](https://github.com/PedroRBC/orbit/actions/runs/40696551059).

## Rodar

Requisitos: **Node.js 22.12+** (testado com 24), npm e, se não houver binário SQLite pronto, ferramentas de compilação nativas.

```bash
npm install
cp .env.example .env
npm run dev
```

Na primeira vez, crie o acesso: `npm run auth -- setup` pede uma senha (mínimo 12 caracteres), mostra a chave para seu app autenticador (TOTP) e oito códigos de recuperação. Depois abra **http://127.0.0.1:3000** e entre com a senha e o código de 6 dígitos. `npm run dev` aplica migrações e inicia interface e worker; Ctrl+C encerra ambos. Se a porta estiver ocupada, o comando falha sem deixar um segundo worker rodando.

npm 12 pode bloquear scripts nativos por padrão. O `allowScripts` no package.json autoriza somente as versões instaladas de better-sqlite3 e esbuild. Se atualizar essas versões, revise a lista de scripts antes de aprovar as novas.

1. Em **Configurações**, informe interesses e assuntos a evitar.
2. Em **Fontes**, cadastre canais com ID `UC…` ou URL `https://www.youtube.com/channel/UC…`.
3. Configure a IA no `.env` (no Docker, em `/config/orbit.env`). URL, chave, modelos e limites são relidos automaticamente; reinicie somente para aplicar atualização de código ou alterar portas/banco.
4. Clique em **Atualizar fontes**. Acompanhe a fila em **Status**.

Sem IA, o app abre e coleta metadados, mas não inventa notas ou resumos. Sem canais/preferências, mostra configuração inicial, não conteúdo de demonstração.

### Encontrar o ID do canal

O RSS exige o identificador de canal, não o nome nem o link `@handle`. No YouTube, procure **Sobre o canal → Compartilhar canal → Copiar ID do canal**. Os nomes das opções podem variar. URLs `/channel/UC…` também servem. Nesta fase não há importação de inscrições nem resolução automática de handles.

## Login nas plataformas pelo seu navegador

O Orbit não abre navegador automatizado nem guarda sessões das plataformas. Você entra no YouTube, X, Instagram e Valete+ pelo Helium do seu computador, e a extensão Orbit lê os feeds ali e envia só metadados ao seu Orbit, onde quer que ele rode (computador, NAS ou servidor).

### Instalação única da extensão

1. Abra **Conectar navegador** (`/conectar`) no Orbit e clique em **Baixe a extensão**. Descompacte o arquivo.
2. No Helium, abra `chrome://extensions`, ative **Modo de desenvolvedor**, escolha **Carregar sem compactação** e selecione a pasta `orbit-extensao`.
3. No Orbit, gere um **código temporário**. No popup **Orbit — coletor**, informe o endereço mostrado na tela (o HTTPS do seu Orbit, ou `http://127.0.0.1:3000` em desenvolvimento) e cole o código. Ele expira em 10 minutos e só pode ser usado uma vez.
4. O Helium pede acesso ao endereço do Orbit: permita. A extensão só recebe acesso a esse host; ao desconectar, a permissão é devolvida.
5. Entre normalmente nos sites, **no mesmo perfil do navegador em que instalou a extensão**, e mantenha o Helium aberto.
6. Ative as fontes em **Fontes** e clique em **Atualizar fontes**.

A extensão consulta o Orbit a cada 30 segundos; esse alarme não agenda coletas nas plataformas. O worker solicita cada coleta. Com o navegador fechado ou o computador desligado, o Orbit continua mostrando o que já foi coletado e segue com RSS e IA; as fontes pessoais aparecem como "navegador indisponível" até a extensão voltar. Você pode revogar a conexão no Orbit a qualquer momento.

Nas configurações da extensão no Helium, mantenha autorizado o acesso aos sites que deseja coletar. As permissões fixas são YouTube, X, Instagram, Valete+ e localhost; o endereço HTTPS do Orbit é uma permissão opcional concedida por você. Não há `cookies`, `debugger`, `tabs`, `webRequest` nem `<all_urls>`. Regras de rede se aplicam apenas às abas criadas para coleta.

**Conexão com o Orbit:** a extensão usa `/api/companion` no mesmo endereço da interface. Fora de localhost, exige HTTPS e recusa redirecionamentos. Cada pedido leva o token da extensão (só o hash fica no SQLite), o ID da extensão e a origem `chrome-extension://`, sem cookies. A rota só aceita os quatro pedidos (parear, consultar, entregar resultado, desconectar), com payload validado e jobs presos ao lease do worker; nunca aceita URLs ou plataformas arbitrárias nem credenciais. O caminho antigo `/api/extension` é sempre recusado. Cookies, senhas e tokens das plataformas nunca são exportados. Não compartilhe o código de pareamento.

### Como a coleta funciona

A extensão abre uma aba própria em segundo plano, lê somente metadados e fecha a aba ao terminar/falhar. Se você ativar essa aba, ela é preservada e deixa de ser gerenciada. A captura também é interrompida se você assumir a aba ou ela sair do endereço do feed. Não são abertas janelas de coleta quando não existe janela normal do navegador. Abas preexistentes nunca são usadas nem fechadas. Há até 4 rodadas de leitura, rolagem lenta, pausas de 900–1800ms, limite padrão de 20 itens (`COLLECTOR_MAX_ITEMS`, 1–50) e prazo de 45 segundos por captura. A fila espera até dois minutos pela resposta da extensão.

Somente nas abas de coleta, DNR bloqueia mídia, fontes, WebSockets, subframes, hosts externos e requisições de escrita, exceto consultas específicas de leitura do feed (`browse`, `HomeTimeline` e timeline do Instagram). Nenhuma curtida, repost, follow, comentário ou publicação é acionada. Navegação normal pode registrar visualizações/telemetria na plataforma. Mudanças legítimas nas consultas podem exigir ajustar a allowlist, não liberar tudo.

Verificação/CAPTCHA, sessão expirada ou layout desconhecido interrompem a fonte. Resolva o fluxo normal manualmente. Não há stealth, bypass de login ou garantia de que uma plataforma sempre aceitará acesso. Seletores ficam em `src/collectors/selectors/` e leitores compartilhados em `readers.ts`.

Os perfis antigos em `data/browser-profiles/` são preservados, mas não usados pelo novo fluxo. O Chromium do Playwright é necessário apenas para testes automatizados, não para você fazer login.

Um vídeo encontrado no RSS e na home continua único e vinculado às duas fontes. Pausar uma não oculta o item enquanto outra fonte ativa também o fornecer. As classificações concluídas permanecem em cache.

## Conectar Instagram e Valete+

Em **Fontes**, use **Abrir Instagram** e **Abrir Valete+** (ou os links do popup) no navegador onde a extensão está instalada. Faça login normalmente, mantenha o navegador aberto e solicite a atualização pelo Orbit. Não existe perfil separado nem exportação de cookie.

**Instagram:** lê posts/reels reconhecidos no feed. A legenda só é guardada quando há um seletor identificável de legenda; comentários, stories e mensagens não entram na coleta. Se o layout não expuser a legenda por esses seletores, o registro indica apenas os metadados disponíveis. Consultas POST ficam bloqueadas, exceto o endpoint de leitura `/api/v1/feed/timeline/`; mudanças para consultas GraphQL diferentes podem exigir revisão explícita da allowlist. Não há fallback liberando todas as requisições.

**Valete+:** usa a [documentação não oficial fornecida](https://github.com/PedroRBC/valete-plus-api). Faz `GET /api/post?filter=all` com a sessão do app, sem Bearer extraído ou login automático. Valida status, tipo JSON e formato; HTML de login, redirecionamentos de autenticação, verificações e 429 interrompem a fonte. Em timeout/falha transitória 5xx/rede, pode ler apenas posts já visíveis no DOM do próprio feed, com permalink real e evidência `valete_dom`; nunca faz esse fallback sobre login negado ou verificação. Não usa `/api/post/by-id`, documentado como indisponível.

O coletor Valete lê somente a primeira página e cruza os IDs de post com links reais do feed. O `Article.id` não substitui o ID do post. **Não fabrica slugs**: itens sem permalink reconhecido são omitidos; ausência total gera erro de layout. Artigos/reposts são convertidos em texto por DOMParser inerte; scripts e embeds são removidos, nunca renderizados no Orbit. Limites: resposta de 2 MB, trecho de 12.000 caracteres e número configurado de itens. Não é coleta integral do histórico e não republica HTML completo. Thumbnails do Valete só são retidas quando a URL original pertence à origem `https://app.valete.org.br`; buckets/CDNs de terceiros não são liberados sem evidência do fornecedor.

Respostas **429** mantêm a fonte em pausa conforme `Retry-After`, inclusive após reiniciar o app. Sem cabeçalho válido, a pausa padrão é 15 minutos. As outras fontes continuam. Verificação/CAPTCHA exige ação manual, sem contorno.

Instagram e Valete têm testes sintéticos em Chromium. Também houve teste assistido com autenticação real no perfil Default do T3 Code: três recomendações da home YouTube, dois posts Instagram e três posts Valete foram normalizados e persistidos localmente, sem exportar cookies ou chamar IA. Esse teste revelou e corrigiu os seletores atuais de autor/legenda do Instagram e acrescentou leitura do bootstrap autenticado da home YouTube quando o DOM não renderiza. O X pediu login no perfil Default e não foi coletado. **Esse foi um teste assistido, anterior à extensão**: o perfil Default do T3 não era herdado pelo worker. Agora a coleta autônoma usa o navegador normal onde a extensão foi instalada e pareada, não aquele transporte assistido. Os registros do teste indicam essa origem no painel Status. Os endpoints internos, seletores e permalinks podem mudar; esta limitação aparece como erro isolado, não como dados inventados.

## Fora da bolha: RSS de notícias externas

Em **Fontes → Notícias externas**, cadastre RSS/Atom públicos em HTTPS. Nenhum portal é habilitado por padrão. Até dez feeds, com títulos/trechos e links, sem baixar artigos ou imagens. Não forneça credenciais ou URLs privadas.

A seção **Fora da bolha** mostra até três itens com publicação comprovada (`newsPublishedAt`) nas últimas 48 horas, sem datas futuras, e exclui notícias já citadas no briefing pessoal mais recente antes de limitar os candidatos. Com IA, prioriza temas diferentes da amostra pessoal e diversidade entre os selecionados; a nota dessas notícias usa importância geral, não o perfil pessoal. Sem IA, exibe manchetes/trechos originais e declara que não há análise. Não inventa notas nem notícias para completar a lista. Esse recorte não prova que seu algoritmo omitiu um assunto, nem é checagem de fatos.

Notícias externas continuam excluídas de **Vale a pena ver**. Até três notícias analisadas, sem spam, de fontes ativas e com publicação comprovada nas últimas 24 h podem complementar o briefing pessoal, sempre marcadas como externas; sem item pessoal elegível, ele não é gerado. Links diretos às quatro plataformas sociais não entram como notícias externas. URLs duplicadas são deduplicadas; um item fornecido por duas fontes continua vinculado às duas.

Proteção de rede: hostname HTTPS, sem IP literal, credenciais ou porta especial. Todos os endereços DNS precisam ser públicos; a conexão usa o IP validado com SNI, Host e certificado do portal original. Cada redirect é validado novamente (máximo três). Bloqueia loopback, redes privadas, link-local, IPv4 mapeado e intervalos reservados, inclusive em DNS misto. Há teto de 2 MB, prazo absoluto de 20 segundos e recusa de DTD/entidades XML. Feeds que não entreguem XML sem compactação mesmo após pedir `identity` falham de forma isolada.

## Agendamento local

A agenda de **coleta pessoal** usa, por padrão, **08:00, 14:00 e 20:00 no fuso do computador**. Edite/pause em **Configurações → Coleta pessoal**. Ela é independente dos briefings gerais 08h/16h. Defaults do `.env`:

```dotenv
SCHEDULER_ENABLED=true
COLLECTOR_CRON=0 8,14,20 * * *
COLLECTOR_TIMEZONE=
COLLECTOR_MAX_RUNS_PER_DAY=6
```

Fuso vazio usa o sistema; exemplo explícito: `America/Sao_Paulo`. Valores salvos pela interface prevalecem sobre padrões do arquivo e do ambiente. `COLLECTOR_CRON`, `COLLECTOR_TIMEZONE`, `COLLECTOR_MAX_RUNS_PER_DAY`, `COLLECTOR_MAX_ITEMS` e `SCHEDULER_ENABLED` também podem ficar em `orbit.env`; valores não vazios do arquivo prevalecem sobre os do ambiente. `SCHEDULER_ENABLED=false` serve como padrão inicial desativado. Não há serviço instalado no sistema operacional: **app aberto é obrigatório**. Feeds pessoais exigem também o navegador com extensão conectada; RSS públicos continuam sem navegador.

O worker só enfileira com seu lease, fontes ativas e nenhuma coleta pendente/em andamento. Respeita cinco minutos desde a coleta anterior e, por padrão, no máximo seis execuções automáticas em 24 horas (configurável entre 1 e 12). Horários repetidos pelo fim do horário de verão não duplicam a execução. A agenda não recupera em lote todos os horários em que a máquina esteve desligada. Uma execução interrompida já na fila pode ser retomada sem duplicar itens concluídos.

Mudanças de agenda são aplicadas após a execução atual. Cron/fuso inválidos desativam somente o agendamento e mostram aviso; coleta manual continua disponível. O Status mostra próximo horário, origem manual/agendada, duração e falhas por fonte. Retentativas respeitam o Retry-After individual.

## Configurar sua IA

Site e worker usam o mesmo leitor: sem `ORBIT_ENV_FILE`, lê `.env` e depois `.env.local`; com caminho preenchido, lê só esse arquivo (no Docker, `/config/orbit.env`); com `ORBIT_ENV_FILE=""`, não lê arquivo. Se algum arquivo candidato existir, todos os `AI_*` do ambiente são ignorados. Remover uma chave/modelo do arquivo desabilita a configuração, sem reutilizar o valor antigo; arquivo ilegível deixa os `AI_*` ausentes, sem fallback. Para `ORBIT_PUSH_SUBJECT` e os cinco parâmetros de coleta/agenda permitidos, vale arquivo não vazio → ambiente não vazio → padrão. O leitor não altera `process.env`. Valores do arquivo valem na próxima leitura; mudar o ambiente do contêiner exige recriá-lo. Portas, hosts permitidos, banco e outros parâmetros de inicialização continuam só no ambiente; veja a [tabela de variáveis](docs/deploy.md#variáveis).

Em **Configurações → Configuração reconhecida** (`/configuracoes#ia`), confira arquivo, origem dos valores, endpoint sem credenciais, presença da chave, modelos de classificação e briefing, limites, agenda e estado do contato Push. **Status** mostra os dois modelos e o último sucesso é consultado nos resultados persistidos. Falta de `AI_MODEL` também impede briefings; preços próprios são exigidos com teto em USD. O diagnóstico nunca mostra chave nem endereço de contato.

A chave fica **somente no `.env` do servidor**. Nunca a cole em issues, commits ou conversas. Não há análise sem URL, chave e modelo configurados. Itens pessoais exigem perfil; notícias externas podem receber análise geral sem inventar interesses. A análise ocorre em atualizações manuais ou nos horários da agenda habilitada.

### OpenAI Compatible

```dotenv
AI_PROTOCOL=openai
AI_BASE_URL=https://seu-endpoint.example/v1
AI_API_KEY=sua-chave
AI_MODEL=id-do-modelo
```

O serviço precisa aceitar **Chat Completions** (`/chat/completions` acrescentado à URL base), mensagens system/user, `max_tokens` e resposta de texto JSON. Não exige `response_format`, tool calling ou Responses API. Modelos/serviços que só aceitem Responses ou outros parâmetros não são compatíveis com este adaptador básico.

### Anthropic Compatible

```dotenv
AI_PROTOCOL=anthropic
AI_BASE_URL=https://seu-endpoint.example
AI_API_KEY=sua-chave
AI_MODEL=id-do-modelo
```

O SDK acrescenta `/v1/messages`. Inclui Bearer do SDK atual e `x-api-key` para proxies clássicos; o endpoint deve aceitar Messages. A versão de API é a do SDK instalado. Não há fallback automático de modelo ou fornecedor.

Para API oficial Anthropic, a raiz é `https://api.anthropic.com`. Identificadores atuais verificados na [documentação oficial](https://platform.claude.com/docs/en/models/overview): `claude-haiku-5-5` para classificação e `claude-sonnet-5-5` para o briefing. Em endpoints compatíveis, use os IDs oferecidos pelo próprio fornecedor. Não existe modelo padrão escondido.

`AI_BASE_URL` aceita HTTP e HTTPS, inclusive IP da rede local e nome de serviço Docker, sem flag adicional. Por exemplo, no CliProxyApi OpenAI Compatible: `AI_BASE_URL=http://192.168.1.3:8317/v1` (substitua pelo endereço alcançável a partir do contêiner). `localhost` dentro do contêiner é o próprio Orbit, não o NAS nem outro app. **HTTP envia chave e textos sem criptografia: use apenas em rede confiável; prefira HTTPS fora dela.** Credenciais, query e fragmento na URL continuam proibidos. Redirecionamentos são recusados para não propagar credenciais. Os adaptadores removem cabeçalhos herdados do ambiente dos SDKs e usam somente a chave do Orbit; o timeout de 45 segundos também cobre a leitura do corpo.

**Privacidade:** preferências, títulos, descrições e autores seguem para o endpoint escolhido. A retenção depende desse fornecedor. O app não tem analytics próprios, carregamento de fontes tipográficas externas ou publicação de dados. Thumbnails são URLs, carregadas diretamente pelo navegador com referrer desativado; isso ainda faz uma requisição ao servidor da imagem.

## Briefing, tópicos e Meu perfil

Para habilitar o briefing, configure um modelo explicitamente no mesmo serviço:

```dotenv
AI_BRIEFING_MODEL=id-do-modelo-de-briefing
AI_BRIEFING_INPUT_USD_PER_MILLION=
AI_BRIEFING_OUTPUT_USD_PER_MILLION=
```

Com teto diário em USD, os dois preços próprios do modelo de briefing são obrigatórios. Sem `AI_BRIEFING_MODEL`, apenas o briefing fica desabilitado; coleta e classificação continuam funcionando.

O worker seleciona até 8 itens pessoais relevantes, não spam, de fontes ativas e coletados nas últimas 24 horas, mais até 3 notícias RSS analisadas com publicação comprovada na mesma janela. Pessoais entram primeiro no orçamento; externas não usam pesos pessoais, levam descrição de até 1.500 caracteres e podem ser omitidas pelo modelo. Os IDs pessoais enviados precisam aparecer exatamente uma vez; cada externo pode aparecer no máximo uma vez. O modelo recebe títulos/descrições, resumos auxiliares e preferências, produz até 8 tópicos e respeita os assuntos excluídos. Links vêm do banco, nunca da IA. O card separa as contagens e identifica fontes externas; sem externas, mostra o motivo persistido na geração.

A meta é uma leitura de 1–2 minutos e 5–8 tópicos quando há material suficiente. Com poucos itens ou orçamento limitado, a amostra e o briefing ficam menores, explicitamente sinalizados. Publicações originais podem ser mais antigas que a coleta. Isso continua sendo um recorte do feed, não o noticiário mais importante do mundo nem uma checagem de fatos.

O briefing é cacheado por snapshot dos itens candidatos, preferências, protocolo, modelo, endpoint e prompt, **sem incluir o dia UTC**. Repetir o snapshot persistido não faz outra chamada de geração, mesmo com saldo esgotado ou em outro dia; o dia continua no payload e no orçamento. Se o orçamento reduzir a seleção, o card informa o recorte. Apenas aumentar o teto não refaz o briefing. Falhas preservam o briefing anterior e sua data.

**Atualizar briefing pessoal**, na Home, enfileira classificação de pendências e geração sem coletar fontes; exige interesses e configuração completa. **Gerar briefing geral agora**, no destaque Brasil e mundo ou em `/briefings`, exige fuso confirmado e gera uma edição das últimas 24 h com RSS públicos, sem push. Ambos usam a fila durável, o orçamento diário compartilhado e intervalo mínimo de cinco minutos por tipo; uma tarefa do mesmo tipo já pendente/em andamento impede outro pedido. A classificação de pendências pode consumir tokens mesmo quando o briefing pessoal em cache é reutilizado. Detalhes em [briefings.md](docs/briefings.md).

Os oito temas base são sementes de um catálogo aberto: áreas amplas propostas em três itens pessoais distintos podem criar um tema, até 40 no total. RSS e spam não propõem temas. **Temas** mostra sementes, temas criados, até 20 grupos em observação e a ação **Juntar a outro tema**; Meu perfil e filtros usam o catálogo do banco, sem reclassificar itens pagos.

Em cada recomendação: **Gostei**, **Não gostei**, **Salvar** e **Já vi**. O filtro Lista mostra salvos/vistos/não vistos. São ações somente no Orbit; nada é curtido ou salvo na plataforma original.

**Meu perfil** mostra interesses editáveis e pesos por tema. Em itens pessoais, Gostei soma 3, Não gostei subtrai 3, salvar soma 1 e o primeiro clique soma 1. Feedback em notícias RSS continua salvo, mas não altera pesos pessoais; pesos antigos não são limpos. Repetir um voto o desfaz; cliques repetidos não inflam o sinal. Já vi apenas organiza a lista. Pesos visíveis ficam entre -20 e 20 e ajustam o ranking em 2 pontos/unidade; a nota final fica entre 0 e 100. Valores podem ser editados e entram nos próximos prompts. A nota original fica em cache, sem reclassificação paga. Os sinais são somados antes de limitar o peso visível: acima do teto, sinais opostos podem reduzir o acúmulo antes de mudar a nota. Editar o peso redefine esse ponto de partida.

## Limites e custos

```dotenv
AI_DAILY_TOKEN_LIMIT=50000
AI_MAX_OUTPUT_TOKENS=3000
# Opcional: preços reais do seu serviço em USD por milhão de tokens.
AI_INPUT_USD_PER_MILLION=
AI_OUTPUT_USD_PER_MILLION=
AI_DAILY_USD_LIMIT=
```

- Dia de orçamento: **UTC**. Reserva de entrada por bytes UTF-8, margem de protocolo e saída máxima antes de cada chamada.
- Uso informado pelo serviço reconcilia a reserva. JSON inválido conta no consumo; há uma única retentativa de formato.
- Falha ambígua, resposta incompleta ou ausência de `usage` mantém a reserva. Nunca assume chamada gratuita. Se o processo cair ou perder o lease depois de uma chamada paga, mas antes da persistência, uma nova tentativa pode cobrar de novo: cache só garante reutilização de resultados concluídos e gravados.
- Sem preços informados, custo em USD aparece como **indisponível**. O teto em tokens continua funcionando.
- O teto em USD exige ambos os preços. Tarifas especiais, caching cobrado diferentemente e tokenização do fornecedor podem divergir da estimativa local. Use também o limite de gasto do próprio fornecedor para uma garantia financeira.
- Até 25 canais; até 20 entradas RSS por canal; lotes de até 5 que caibam no saldo disponível e até 50 classificações por atualização. Itens grandes não bloqueiam os menores encontrados nas primeiras 50 pendências. Solicite outra atualização para backlog maior.
- Atualizações manuais/agendadas respeitam intervalo mínimo de cinco minutos e não se sobrepõem. O Status mostra teto, saldo, uso/reservas e custos desconhecidos. A coleta continua mesmo se a IA ficar sem orçamento.

## Dados e segurança

SQLite com WAL e migrações versionadas (`data/orbit.db`; `/data` no Docker). Usuário único, sempre com login: senha (scrypt) e código TOTP, ou um código de recuperação. A sessão é um cookie `__Host-` HttpOnly, Secure e SameSite=Strict, válido por 30 dias, com só o hash no banco. **Configurações → Acesso** permite sair deste dispositivo ou de todos; `npm run auth -- setup` troca senha e autenticador e encerra todas as sessões; `npm run auth -- logout-all` só encerra as sessões. Cinco erros seguidos bloqueiam aquele cliente (último endereço do `X-Forwarded-For`) por 15 minutos; não há bloqueio global, e `npm run auth -- unlock` limpa os bloqueios.

Fora de localhost, o login só acontece por HTTPS: publique o Orbit atrás de um proxy reverso (Tailscale Serve, Nginx Proxy Manager, Caddy etc.) que preserve o `Host`, envie `X-Forwarded-Proto: https` e deixe `X-Forwarded-Host` ausente ou igual ao host público (incluindo a porta). Liste o endereço em `ORBIT_ALLOWED_HOSTS`; outros Hosts recebem 403, o que impede DNS rebinding. Requisições de mutação de outra origem são recusadas, e cada Server Action valida a sessão por conta própria.

Backup consistente com o app ligado: `npm run db:backup` (veja [docs/deploy.md](docs/deploy.md) para Docker, restauração e rollback). `.env`, banco e perfis de navegador estão ignorados no Git e fora da imagem Docker.

## Limitações atuais

- As quatro plataformas de navegador exigem login manual e validação real pelo usuário. Testes sintéticos não garantem o layout atual de toda conta.
- RSS de canais não representa seu algoritmo nem garante todo o histórico.
- Não baixa transcrições de vídeos arbitrários: RSS/home não as fornecem e não foi adicionado endpoint extra de legendas sem via estável/autorizada. Resumos indicam título/descrição; duração só é mostrada quando realmente visível.
- Não baixa mídia. Metadados têm campos limitados: títulos até 1.000 caracteres e descrições até 12.000; descrições acima disso são reduzidas na coleta.
- Classificações concluídas ficam em cache mesmo após mudança de preferências. Ranking local usa os pesos atuais; agrupamento semântico de assuntos não é checagem editorial nem detecção perfeita de duplicatas.
- O prompt pede fidelidade às fontes, mas não elimina alucinações. Confira o conteúdo original antes de confiar em afirmações.

## Testar e produção local

```bash
ORBIT_ENV_FILE="" npm test
ORBIT_ENV_FILE="" npm run typecheck
ORBIT_ENV_FILE="" npm run check
ORBIT_ENV_FILE="" npm run build
npx playwright install chromium
ORBIT_ENV_FILE="" DOTENV_CONFIG_PATH=/dev/null npm run test:e2e
# Mesmo fluxo de navegador contra npm start, após o build:
ORBIT_ENV_FILE="" DOTENV_CONFIG_PATH=/dev/null E2E_PRODUCTION=1 npm run test:e2e
```

Os testes não usam API paga: exercitam SDKs contra servidor HTTP local e SQLite real isolado. O e2e inicia app e worker com banco em `test-results/`. A coleta de um canal real depende de rede/YouTube e não é garantida por fixtures.

Após `npm run build`, **`npm start`** inicia a versão de produção e o worker no mesmo comando. No GitHub, o workflow `CI` roda essa mesma bateria em cada PR; a publicação da imagem está descrita em [docs/deploy.md](docs/deploy.md#imagem-no-ghcr).

## Estado da entrega

As cinco fases do app foram implementadas e testadas. Depois, o Orbit virou serviço próprio para Docker/TrueNAS (contêiner com dados persistentes, login com senha + TOTP, extensão conectada pela API e PWA instalável), entregue em fases no PR de implantação. Nenhum teste usou API paga nem o banco real.

Testado automaticamente: unitários, typecheck, build, e2e de produção (inclui extensão real pareada pela API), imagem Docker (saúde, worker, recriação sem perda, migração de banco antigo, reinício após queda, volume sem permissão) e fluxo completo atrás de um proxy HTTPS (Caddy). Pendente de validação sua: instalação no TrueNAS, seu proxy/domínio ou Tailscale, a extensão no seu Helium com permissão do endereço HTTPS, e a instalação do PWA no seu Android/iPhone.

Não há seed de notícias fictícias em produção. Dados sintéticos aparecem somente em bancos isolados de teste.

## Aviso sobre automação

Automatizar YouTube, X, Instagram ou Valete+ **pode violar os termos de uso das plataformas**. Existe risco real de restrição ou bloqueio da conta; baixa frequência não elimina esse risco. Uso estritamente pessoal, local, somente leitura e em baixa frequência. Coletores futuros devem parar em CAPTCHA/verificação, sem contornar proteções nem restrições de acesso.
