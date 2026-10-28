# Briefings gerais: 08h e 16h

## O que é separado

- **Briefing geral** (`/briefings`): RSS públicos que você cadastrou. Coleta no servidor, sem Helium, extensão, cookies de plataformas ou perfil pessoal. Não é uma varredura de todo o noticiário do Brasil/mundo: a abrangência depende das fontes.
- **Seu briefing pessoal** (Hoje): recorte dos feeds/canais pessoais já classificados. `news` continua excluído do SQL desse briefing e das recomendações pessoais.
- **Fora da bolha**: seleção complementar dos mesmos RSS externos, identificada como externa. Não transforma os itens em recomendações pessoais.

Não há portal, canal ou interesse presumido. Sem RSS habilitado, o arquivo registra a configuração necessária em vez de publicar conteúdo fictício.

## Configuração

1. Em **Fontes → Notícias externas**, cadastre RSS público HTTPS de fontes da sua confiança. Até dez feeds; endereços privados, credenciais na URL e redirects inseguros continuam bloqueados. O coletor seguro resolve DNS, valida e pina IP público com TLS/SNI original.
2. Configure o endpoint de IA e **`AI_BRIEFING_MODEL`** no arquivo do servidor. O protocolo, a URL, a chave e o modelo continuam escolhidos por você. No Docker, `/config/orbit.env` recebe somente `AI_*`.
3. Em **Configurações → Briefings gerais**, confirme o fuso IANA e ative a agenda. Os horários são fixos: **08h e 16h no fuso exibido**. A agenda pessoal continua independente.
4. Para push, configure `ORBIT_PUSH_SUBJECT` no ambiente do contêiner/processos, reinicie e siga [Web Push](push.md).

Prioridade do fuso: configuração própria de briefings salva na interface; antes dela, fuso explícito da agenda de coleta ou `COLLECTOR_TIMEZONE`. Sem nenhum deles, a UI propõe **America/Sao_Paulo** e a agenda geral permanece desativada até confirmação. O Compose já fornece esse fuso explicitamente por padrão. Pausar a coleta pessoal não pausa os briefings; use seu controle próprio.

## Cobertura e atualização

- **08h:** notícias com data de publicação nas 24 horas anteriores ao fechamento.
- **16h:** notícias publicadas desde 08h até o fechamento. Exclui IDs e manchetes normalizadas já usados na edição matinal do mesmo dia/fuso. O modelo recebe o resumo da manhã somente como contexto, não como prova de uma novidade.
- Cada edição mostra data, fuso, período coberto, fechamento programado e horário real de geração. Um atraso não estende silenciosamente o período nem apresenta uma edição antiga como atual.
- Itens sem data comprovada de publicação, anteriores à janela ou posteriores ao fechamento não entram. O coletor exige `pubDate` original do RSS ou `published` original do Atom; não usa `updated`, `isoDate` sintetizada pelo parser ou data genérica `dc:date` como prova de publicação. A coleta recente não torna uma notícia antiga atual. Reutilização de uma URL pelo portal continua sujeita à deduplicação existente; a primeira publicação comprovada não é avançada quando o portal republica o mesmo link. O Orbit não compara versões integrais de artigos.
- `raw_items.newsPublishedAt` é a data de publicação comprovada pelo coletor corrigido. Registros legados ficam com esse campo nulo até uma nova coleta comprovar a data; não são aceitos automaticamente pelo valor antigo de `publishedAt`, que pode ter vindo de `updated`. A nova coleta só preenche o campo ainda nulo, preservando texto, vínculos, cache e o valor histórico de `publishedAt`.
- A seleção considera até 200 notícias recentes elegíveis, remove manchetes repetidas e distribui até doze candidatas entre as origens. O orçamento pode reduzir a amostra. A IA organiza de um a oito destaques, com resumo, contexto, relevância e IDs de fontes validados. Links, autores e datas são recuperados do banco, nunca gerados pela IA.
- Apenas título/trecho RSS são enviados, não a reportagem integral ou mídia. Não há mecanismo de checagem factual externa. As fontes podem conter erro; confira os originais.
- Falha de uma fonte é isolada. RSS em cooldown respeita `Retry-After`. Se houver notícias datadas já disponíveis na janela, podem fundamentar uma edição com aviso de fonte não atualizada. Sem novidades válidas, sem IA ou sem saldo, fica um registro indisponível/erro, não um resumo inventado. Edições anteriores continuam acessíveis.

## Fila, reinício e atraso

O scheduler geral calcula os slots 08h/16h pelo fuso usando `Intl`, inclusive transições de horário de verão, e verifica o slot recente uma vez por minuto do laço do worker. A chave única é `fuso:data-local:hora`; reiniciar não cria outra edição do mesmo fechamento.

`collector_runs.kind = edition` e `editionId` reutilizam a fila durável existente. O worker sob lease executa uma tarefa por vez e coleta apenas `news_rss` nesse caminho. Os jobs de edição não consomem a cota de coletas pessoais nem fazem uma coleta pessoal no mesmo horário desaparecer. Não há processamento de IA na renderização da página.

A recuperação considera **somente o fechamento vencido há até duas horas**, inclusive depois de reinício. Não recupera dias perdidos, nem enfileira uma tempestade de execuções. Uma edição que permaneceu na fila por mais de duas horas fica indisponível por atraso. Não há retry automático contínuo após falha: uma interrupção enquanto o job estava em execução pode ser retomada, no máximo duas tentativas persistidas por edição. Uma chamada ambígua mantém a reserva de orçamento; a retomada pode consumir outra chamada dentro do teto, nunca libera a reserva anterior sem prova de consumo.

Uma edição publicada não é gerada novamente. Publicação dos dados finais e inserção da outbox push ocorrem na mesma transação sob lease. O push usa tentativa única, sem reenvio ambíguo; isso pode perder avisos em quedas, não duplica tentativas deliberadamente. Veja os limites em [push.md](push.md).

As páginas e os links de notificação exigem login. O service worker continua guardando somente `/offline.html`: arquivo de edições é persistência no servidor, não cache pessoal offline no aparelho.

## Armazenamento e migração

`editions` persiste slot, data local/fuso, período, estado, tentativas, conteúdo, IDs citados, modelo, avisos e tempos. `collector_runs` ganha `kind` e `editionId`, preservando os jobs antigos com tipo `collection`. Migrations `0008`/`0009` adicionam edições e outbox/inscrições push; `0010` adiciona a data comprovada de publicação de notícias, inicialmente nula para registros legados. A consolidação de temas é uma transação própria, descrita em [taxonomy.md](taxonomy.md).

Antes de aplicar esta atualização a um banco real, faça backup online verificado e proteja o arquivo e seus backups. Nenhuma migração foi executada no banco original do usuário ou no TrueNAS nesta entrega. A nova implementação faz parte da versão `0.2.1`, cujo commit/push/lançamento pela tag foi autorizado. A imagem só está disponível depois de a CI concluir testes e verificações de publicação privada. A imagem anterior `0.2.0` não contém estas mudanças; a main e `latest` não são promovidas por este lançamento.

## Validação sem serviço pago

- `tests/editions.test.ts`: fuso, proposta explícita, 08h/16h, horário de verão, janela de atraso, unicidade/reinício, separação da fila/cota pessoal e lease.
- `tests/edition-generation.test.ts`: período, fontes pausadas, datas inválidas para a janela, exclusão da manhã à tarde, IDs válidos, publicação/cache, outbox e limite de retomadas.
- `tests/worker-edition.test.ts`: worker real com SQLite isolado, RSS bloqueado antes da rede e feed pessoal que não é acionado.
- `tests/e2e/editorial.spec.ts`: arquivo privado, links, fuso/período, mobile, separação pessoal e erro de configuração.

As fixtures estão apenas em testes e são identificadas como sintéticas. Nenhuma API paga é usada.
