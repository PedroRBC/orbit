# Orbit

Curador pessoal de conteúdo, local e em português. **Cinco fases implementadas:** YouTube RSS/home, X Para você, Instagram, Valete+, recomendações de IA, briefing com fontes, feedback, perfil aprendido, Fora da bolha por RSS externo, agenda e controle de custo.

Não confunda o que seus feeds mostram com uma visão completa do mundo. O Orbit indica fontes e limites da análise.

## Docker e TrueNAS

O Orbit roda como um serviço em contêiner: interface, worker e migrações juntos, banco SQLite persistente e IA configurada fora da imagem. Instalação, volumes, backup, atualização e diagnóstico estão em [docs/deploy.md](docs/deploy.md).

## Rodar

Requisitos: **Node.js 22.12+** (testado com 24), npm e, se não houver binário SQLite pronto, ferramentas de compilação nativas.

```bash
npm install
cp .env.example .env
npm run dev
```

Abra **http://127.0.0.1:3000**. Após a instalação/configuração, `npm run dev` é o único comando necessário: aplica migrações, inicia interface e worker. Ctrl+C encerra ambos. Se a porta estiver ocupada, o comando falha sem deixar um segundo worker rodando.

npm 12 pode bloquear scripts nativos por padrão. O `allowScripts` no package.json autoriza somente as versões instaladas de better-sqlite3 e esbuild. Se atualizar essas versões, revise a lista de scripts antes de aprovar as novas.

1. Em **Configurações**, informe interesses e assuntos a evitar.
2. Em **Fontes**, cadastre canais com ID `UC…` ou URL `https://www.youtube.com/channel/UC…`.
3. Configure a IA no `.env`. URL, chave, modelos e limites são relidos automaticamente; reinicie somente para aplicar atualização de código ou alterar portas/banco.
4. Clique em **Atualizar fontes**. Acompanhe a fila em **Status**.

Sem IA, o app abre e coleta metadados, mas não inventa notas ou resumos. Sem canais/preferências, mostra configuração inicial, não conteúdo de demonstração.

### Encontrar o ID do canal

O RSS exige o identificador de canal, não o nome nem o link `@handle`. No YouTube, procure **Sobre o canal → Compartilhar canal → Copiar ID do canal**. Os nomes das opções podem variar. URLs `/channel/UC…` também servem. Nesta fase não há importação de inscrições nem resolução automática de handles.

## Login pelo seu navegador habitual

O login **não abre mais um Chromium automatizado**. O comando `npm run login -- youtube` abre o manipulador HTTPS normal do sistema, que nesta máquina é o Helium. Você também pode usar **Entrar pelo meu navegador** em Fontes ou os links no popup da extensão.

### Instalação única da extensão local

1. Inicie o Orbit com `npm run dev` e abra **http://127.0.0.1:3000/conectar**.
2. No Helium, abra `chrome://extensions`, ative **Modo de desenvolvedor** e escolha **Carregar sem compactação**.
3. Selecione a pasta `browser-extension/dist` deste projeto. Ela é gerada automaticamente ao iniciar/buildar o app; isoladamente, use `npm run build:extension`.
4. No Orbit, gere um **código temporário**. Abra o popup **Orbit — coletor local**, informe o endereço da ponte mostrado na tela (padrão `http://127.0.0.1:3001`) e cole o código. Ele expira em 10 minutos e só pode ser usado uma vez.
5. Faça login normalmente nos sites, **no mesmo perfil do navegador em que instalou a extensão**. Não precisa fechar as janelas. Mantenha o Helium aberto.
6. Ative as fontes em **Fontes** e clique em **Atualizar fontes** no Orbit.

A extensão consulta somente pedidos locais a cada 30 segundos; esse alarme não agenda coletas nas plataformas por conta própria. O worker continua responsável por solicitar cada coleta. Sem conexão, aparece um aviso em vez de abrir outro navegador ou copiar cookies. Você pode revogar a conexão no Orbit a qualquer momento.

Nas configurações da extensão no Helium, mantenha autorizado o acesso aos sites que deseja coletar. Se o acesso estiver restrito, o Orbit informa a necessidade de permissão. As permissões são limitadas a YouTube, X, Instagram, Valete+ e localhost; não há `cookies`, `debugger`, `tabs`, `webRequest` nem `<all_urls>` nas permissões do manifesto. Regras de rede se aplicam apenas às abas criadas para coleta, não às abas em que você navega ou faz login.

A ponte escuta em uma porta própria, **somente em 127.0.0.1**, mesmo se a interface estiver acessível pela LAN. Por padrão usa a porta do app + 1 (3001); `ORBIT_EXTENSION_PORT` pode alterá-la. A porta da interface recusa as rotas da ponte, inclusive com Host forjado. O token da conexão local fica em storage.local restrito da extensão e somente seu hash no SQLite. É separado de qualquer sessão de plataforma. Cookies, senhas, tokens de login e localStorage das plataformas nunca são exportados. O código de pareamento não deve ser compartilhado em chat ou logs.

### Como a coleta funciona

A extensão abre uma aba própria em segundo plano, lê somente metadados e fecha a aba ao terminar/falhar. Se você ativar essa aba, ela é preservada e deixa de ser gerenciada. A captura também é interrompida se você assumir a aba ou ela sair do endereço do feed. Não são abertas janelas de coleta quando não existe janela normal do navegador. Abas preexistentes nunca são usadas nem fechadas. Há até 4 rodadas de leitura, rolagem lenta, pausas de 900–1800ms, limite padrão de 20 itens (`COLLECTOR_MAX_ITEMS`, 1–50) e prazo de 45 segundos por captura. A fila espera até dois minutos pela resposta da extensão.

Somente nas abas de coleta, DNR bloqueia mídia, fontes, WebSockets, subframes, hosts externos e requisições de escrita, exceto consultas específicas de leitura do feed (`browse`, `HomeTimeline` e timeline do Instagram). Nenhuma curtida, repost, follow, comentário ou publicação é acionada. Navegação normal pode registrar visualizações/telemetria na plataforma. Mudanças legítimas nas consultas podem exigir ajustar a allowlist, não liberar tudo.

Verificação/CAPTCHA, sessão expirada ou layout desconhecido interrompem a fonte. Resolva o fluxo normal manualmente. Não há stealth, bypass de login ou garantia de que uma plataforma sempre aceitará acesso. Seletores ficam em `src/collectors/selectors/` e leitores compartilhados em `readers.ts`.

Os perfis antigos em `data/browser-profiles/` são preservados, mas não usados pelo novo fluxo. O Chromium do Playwright é necessário apenas para testes automatizados, não para você fazer login.

Um vídeo encontrado no RSS e na home continua único e vinculado às duas fontes. Pausar uma não oculta o item enquanto outra fonte ativa também o fornecer. As classificações concluídas permanecem em cache.

## Conectar Instagram e Valete+

```bash
npm run login -- instagram
npm run login -- valete
```

Os comandos abrem seu navegador padrão normal. Faça login no perfil em que instalou a extensão, mantenha o navegador aberto e solicite a atualização pelo Orbit. Não existe mais perfil separado obrigatório nem exportação de cookie.

**Instagram:** lê posts/reels reconhecidos no feed. A legenda só é guardada quando há um seletor identificável de legenda; comentários, stories e mensagens não entram na coleta. Se o layout não expuser a legenda por esses seletores, o registro indica apenas os metadados disponíveis. Consultas POST ficam bloqueadas, exceto o endpoint de leitura `/api/v1/feed/timeline/`; mudanças para consultas GraphQL diferentes podem exigir revisão explícita da allowlist. Não há fallback liberando todas as requisições.

**Valete+:** usa a [documentação não oficial fornecida](https://github.com/PedroRBC/valete-plus-api). Faz `GET /api/post?filter=all` com a sessão do app, sem Bearer extraído ou login automático. Valida status, tipo JSON e formato; HTML de login, redirecionamentos de autenticação, verificações e 429 interrompem a fonte. Em timeout/falha transitória 5xx/rede, pode ler apenas posts já visíveis no DOM do próprio feed, com permalink real e evidência `valete_dom`; nunca faz esse fallback sobre login negado ou verificação. Não usa `/api/post/by-id`, documentado como indisponível.

O coletor Valete lê somente a primeira página e cruza os IDs de post com links reais do feed. O `Article.id` não substitui o ID do post. **Não fabrica slugs**: itens sem permalink reconhecido são omitidos; ausência total gera erro de layout. Artigos/reposts são convertidos em texto por DOMParser inerte; scripts e embeds são removidos, nunca renderizados no Orbit. Limites: resposta de 2 MB, trecho de 12.000 caracteres e número configurado de itens. Não é coleta integral do histórico e não republica HTML completo. Thumbnails do Valete só são retidas quando a URL original pertence à origem `https://app.valete.org.br`; buckets/CDNs de terceiros não são liberados sem evidência do fornecedor.

Respostas **429** mantêm a fonte em pausa conforme `Retry-After`, inclusive após reiniciar o app. Sem cabeçalho válido, a pausa padrão é 15 minutos. As outras fontes continuam. Verificação/CAPTCHA exige ação manual, sem contorno.

Instagram e Valete têm testes sintéticos em Chromium. Também houve teste assistido com autenticação real no perfil Default do T3 Code: três recomendações da home YouTube, dois posts Instagram e três posts Valete foram normalizados e persistidos localmente, sem exportar cookies ou chamar IA. Esse teste revelou e corrigiu os seletores atuais de autor/legenda do Instagram e acrescentou leitura do bootstrap autenticado da home YouTube quando o DOM não renderiza. O X pediu login no perfil Default e não foi coletado. **Esse foi um teste assistido, anterior à extensão**: o perfil Default do T3 não era herdado pelo worker. Agora a coleta autônoma usa o navegador normal onde a extensão foi instalada e pareada, não aquele transporte assistido. Os registros do teste indicam essa origem no painel Status. Os endpoints internos, seletores e permalinks podem mudar; esta limitação aparece como erro isolado, não como dados inventados.

## Fora da bolha: RSS de notícias externas

Em **Fontes → Notícias externas**, cadastre RSS/Atom públicos em HTTPS. Nenhum portal é habilitado por padrão. Até dez feeds, com títulos/trechos e links, sem baixar artigos ou imagens. Não forneça credenciais ou URLs privadas.

A seção **Fora da bolha** mostra até três itens coletados nas últimas 48 horas. Com IA, prioriza temas diferentes da amostra pessoal e diversidade entre os selecionados; a nota dessas notícias usa importância geral, não o perfil pessoal. Sem IA, exibe manchetes/trechos originais e declara que não há análise. Não inventa notas nem notícias para completar a lista. Esse recorte não prova que seu algoritmo omitiu um assunto, nem é checagem de fatos.

Notícias externas são excluídas do briefing pessoal e de “Vale a pena ver”. Links diretos às quatro plataformas sociais não entram como notícias externas. URLs duplicadas são deduplicadas; um item fornecido por duas fontes continua vinculado às duas.

Proteção de rede: hostname HTTPS, sem IP literal, credenciais ou porta especial. Todos os endereços DNS precisam ser públicos; a conexão usa o IP validado com SNI, Host e certificado do portal original. Cada redirect é validado novamente (máximo três). Bloqueia loopback, redes privadas, link-local, IPv4 mapeado e intervalos reservados, inclusive em DNS misto. Há teto de 2 MB, prazo absoluto de 20 segundos e recusa de DTD/entidades XML. Feeds que não entreguem XML sem compactação mesmo após pedir `identity` falham de forma isolada.

## Agendamento local

Padrão: **08:00, 14:00 e 20:00 no fuso do computador**. Edite/pausa em **Configurações → Coleta no seu ritmo**. Defaults do `.env`:

```dotenv
SCHEDULER_ENABLED=true
COLLECTOR_CRON=0 8,14,20 * * *
COLLECTOR_TIMEZONE=
COLLECTOR_MAX_RUNS_PER_DAY=6
```

Fuso vazio usa o sistema; exemplo explícito: `America/Sao_Paulo`. Valores salvos pela interface prevalecem sobre defaults do ambiente. `SCHEDULER_ENABLED=false` serve como padrão inicial desativado. Não há serviço instalado no sistema operacional: **app aberto é obrigatório**. Feeds pessoais exigem também o navegador com extensão conectada; RSS públicos continuam sem navegador.

O worker só enfileira com seu lease, fontes ativas e nenhuma coleta pendente/em andamento. Respeita cinco minutos desde a coleta anterior e, por padrão, no máximo seis execuções automáticas em 24 horas (configurável entre 1 e 12). Horários repetidos pelo fim do horário de verão não duplicam a execução. A agenda não recupera em lote todos os horários em que a máquina esteve desligada. Uma execução interrompida já na fila pode ser retomada sem duplicar itens concluídos.

Mudanças de agenda são aplicadas após a execução atual. Cron/fuso inválidos desativam somente o agendamento e mostram aviso; coleta manual continua disponível. O Status mostra próximo horário, origem manual/agendada, duração e falhas por fonte. Retentativas respeitam o Retry-After individual.

## Configurar sua IA

Configurações de IA são relidas de `.env` (e `.env.local`, se existir) no início de cada análise e na tela, sem manter a cópia antiga herdada pelo worker. Esses arquivos prevalecem para os campos `AI_*`. Remover uma chave/modelo do arquivo desabilita a configuração, sem reutilizar o valor antigo. Portas, banco e outros parâmetros de inicialização ainda exigem reiniciar. Para executar somente com variáveis exportadas, use `ORBIT_ENV_FILE=""`; os testes usam esse modo para nunca ler sua chave real.

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

Endpoints remotos exigem HTTPS. Para um servidor de inferência no próprio computador, HTTP em `localhost`, `127.0.0.1` ou `[::1]` é permitido. Redirecionamentos são recusados para não propagar credenciais. Os adaptadores removem cabeçalhos herdados do ambiente dos SDKs e usam somente a chave do Orbit; o timeout de 45 segundos também cobre a leitura do corpo.

**Privacidade:** preferências, títulos, descrições e autores seguem para o endpoint escolhido. A retenção depende desse fornecedor. O app não tem analytics próprios, carregamento de fontes tipográficas externas ou publicação de dados. Thumbnails são URLs, carregadas diretamente pelo navegador com referrer desativado; isso ainda faz uma requisição ao servidor da imagem.

## Briefing, tópicos e Meu perfil

Para habilitar o briefing, configure um modelo explicitamente no mesmo serviço:

```dotenv
AI_BRIEFING_MODEL=id-do-modelo-de-briefing
AI_BRIEFING_INPUT_USD_PER_MILLION=
AI_BRIEFING_OUTPUT_USD_PER_MILLION=
```

Com teto diário em USD, os dois preços próprios do modelo de briefing são obrigatórios. Sem `AI_BRIEFING_MODEL`, apenas o briefing fica desabilitado; coleta e classificação continuam funcionando.

O worker seleciona até 8 itens relevantes, não spam, de fontes ativas e coletados nas últimas 24 horas. O modelo recebe títulos/descrições originais, resumos auxiliares e preferências. Agrupa o mesmo assunto, produz até 8 tópicos e cita somente IDs recebidos. Links são resolvidos pelo banco local, nunca inventados pelo modelo.

A meta é uma leitura de 1–2 minutos e 5–8 tópicos quando há material suficiente. Com poucos itens ou orçamento limitado, a amostra e o briefing ficam menores, explicitamente sinalizados. Publicações originais podem ser mais antigas que a coleta. Isso continua sendo um recorte do feed, não o noticiário mais importante do mundo nem uma checagem de fatos.

O briefing é cacheado por dia UTC, snapshot dos itens, preferências, modelo, endpoint e prompt. Repetir o snapshot persistido não faz outra chamada, mesmo com saldo esgotado. Se o orçamento reduzir a seleção, o briefing mostra quantos candidatos ficaram de fora; esse recorte continua cacheado até mudar o conteúdo, o perfil ou o dia UTC. Apenas aumentar o teto não refaz o briefing. Falhas preservam o briefing anterior, que mostra sua data. Mudanças no perfil ou novos itens podem gerar um novo briefing na próxima atualização.

Em cada recomendação: **Gostei**, **Não gostei**, **Salvar** e **Já vi**. O filtro Lista mostra salvos/vistos/não vistos. São ações somente no Orbit; nada é curtido ou salvo na plataforma original.

**Meu perfil** mostra interesses editáveis e pesos por tema. Gostei soma 3, Não gostei subtrai 3, salvar soma 1 e o primeiro clique soma 1. Repetir um voto o desfaz; cliques repetidos não inflam o sinal. Já vi apenas organiza a lista. Pesos visíveis ficam entre -20 e 20 e ajustam o ranking em 2 pontos/unidade; a nota final fica entre 0 e 100. Valores podem ser editados e entram nos próximos prompts. A nota original fica em cache, sem reclassificação paga. Os sinais são somados antes de limitar o peso visível: acima do teto, sinais opostos podem reduzir o acúmulo antes de mudar a nota. Editar o peso redefine esse ponto de partida.

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

SQLite em `data/orbit.db`, com WAL e migrações versionadas. Não há login ou multiusuário. O processo escuta **127.0.0.1 por padrão**. Não exponha o app à internet.

Para ativar acesso pelo celular na mesma rede, altere explicitamente `ORBIT_HOST=0.0.0.0` no `.env`, reinicie e acesse o IP privado do computador na porta configurada. **Isso permite acesso às preferências, fontes e controles por qualquer pessoa nessa rede.** Use apenas rede confiável e regras de firewall. Nomes DNS arbitrários são recusados para mitigar DNS rebinding.

Não apague `data/` para atualizar o app. Para backup, pare o Orbit e copie a pasta `data/` inteira, incluindo arquivos WAL se existirem. `.env`, banco e perfis de navegador estão ignorados no Git.

## Limitações atuais

- As quatro plataformas de navegador exigem login manual e validação real pelo usuário. Testes sintéticos não garantem o layout atual de toda conta.
- RSS de canais não representa seu algoritmo nem garante todo o histórico.
- Não baixa transcrições de vídeos arbitrários: RSS/home não as fornecem e não foi adicionado endpoint extra de legendas sem via estável/autorizada. Resumos indicam título/descrição; duração só é mostrada quando realmente visível.
- Não baixa mídia. Metadados têm campos limitados: títulos até 1.000 caracteres e descrições até 12.000; descrições acima disso são reduzidas na coleta.
- Classificações concluídas ficam em cache mesmo após mudança de preferências. Ranking local usa os pesos atuais; agrupamento semântico de assuntos não é checagem editorial nem detecção perfeita de duplicatas.
- O prompt pede fidelidade às fontes, mas não elimina alucinações. Confira o conteúdo original antes de confiar em afirmações.

## Testar e produção local

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
# Mesmo fluxo de navegador contra npm start, após o build:
E2E_PRODUCTION=1 npm run test:e2e
```

Os testes não usam API paga: exercitam SDKs contra servidor HTTP local e SQLite real isolado. O e2e inicia app e worker com banco em `test-results/`. A coleta de um canal real depende de rede/YouTube e não é garantida por fixtures.

Após `npm run build`, **`npm start`** inicia a versão de produção e o worker no mesmo comando.

## Estado da entrega

As cinco fases foram implementadas, testadas incrementalmente e autorizadas em sequência. O novo login por extensão foi uma alteração aprovada para evitar o browser automatizado recusado pelo Google. Falta sua validação final com a extensão instalada no perfil real do Helium, seus canais/RSS/interesses e o endpoint de IA escolhido. Nenhum teste usou API paga.

Não há seed de notícias fictícias em produção. Dados sintéticos aparecem somente em bancos isolados de teste. Resultados assistidos reais anteriores estão identificados no histórico; não são prova de que a extensão já foi instalada no seu navegador.

## Aviso sobre automação

Automatizar YouTube, X, Instagram ou Valete+ **pode violar os termos de uso das plataformas**. Existe risco real de restrição ou bloqueio da conta; baixa frequência não elimina esse risco. Uso estritamente pessoal, local, somente leitura e em baixa frequência. Coletores futuros devem parar em CAPTCHA/verificação, sem contornar proteções nem restrições de acesso.
