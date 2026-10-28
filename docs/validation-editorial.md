# Validação da evolução editorial — 28/10/2026

## Ambiente e limites

Implementação isolada em `/home/pedro/.t3/projects/orbit/.claude/worktrees/orbit-editorial`, branch `worktree-orbit-editorial`, a partir da main `327aa793`. Na etapa de implementação não houve commit, push, merge, publicação de imagem ou alteração no TrueNAS. Depois, o usuário autorizou commit, push e lançamento de `0.2.1`; essa etapa publica por tag no destino privado existente, sem merge na main ou alteração no NAS. Alterações locais de autenticação e `next-env.d.ts` do checkout principal não foram levadas nem sobrescritas.

Os nomes de temas existentes foram consultados somente em conexão readonly; não foi aplicada migração ao banco real. Uma cópia temporária privada, criada pelo backup online do SQLite a partir de conexão readonly/query-only, foi migrada e removida após verificação. Na cópia: **57 itens brutos, 57 classificações, 57 vínculos, 8 feedbacks, 2 briefings e 15 agrupamentos preservados**. Havia **54 temas legados**, consolidados em **7 categorias utilizadas** do catálogo de oito. **29 itens e um peso** foram para Outros por falta de alias/recorte inequívoco, mantendo auditoria do original. Hashes internos verificaram conteúdo/vínculos/perfil/histórico sem expô-los; `integrity_check=ok`, `foreign_key_check` vazio e segunda abertura sem alteração de pesos. Nenhum histórico de navegação, cookie, token de plataforma ou chave do app foi coletado. Não houve API paga nem push para provedor/aparelho real. Testes usam SQLite isolado, dados sintéticos, HTTP local de fixture e mocks DNS/HTTPS do push.

## Evidências por etapa

- **Base antes de implementar:** 22 arquivos, 123 testes passaram.
- **Integração intermediária:** 28 arquivos, 248 testes passaram; `npm run typecheck` passou.
- **Build de produção intermediário:** passou com `ORBIT_ENV_FILE=''` e variáveis de IA vazias. Rotas de briefing são dinâmicas e protegidas, não páginas estáticas com dados pessoais.
- **Primeiro e2e de produção:** 13 de 15 passaram. Duas falhas eram seletores ambíguos: o anunciador de rota do Next também usa `role=alert`, e `Salvar agenda` também selecionava `Salvar agenda dos briefings`. Corrigidos os seletores para a seção/ação exata; não foi relaxada a verificação funcional.
- **Verificação final antes da revisão:** **28 arquivos e 251 testes passaram**, typecheck passou, build de produção passou e **15/15 e2e de produção passaram**. IA vazia/`ORBIT_ENV_FILE=''`; nenhuma API paga. Foram rechecadas as capturas desktop/móvel após a correção de hierarquia/fontes. A revisão independente foi concluída e encontrou um P2: `rss-parser` usava `updated` de Atom como `pubDate`, admitindo conteúdo sem data de publicação nas edições. O caso foi reproduzido em teste (RED), corrigido no coletor e na seleção/persistência, e passou (GREEN). A migração `0010` mantém datas legadas intactas e só permite edições com `newsPublishedAt` comprovado por coleta nova; republicar o mesmo link não avança a primeira publicação comprovada. Nenhum outro achado importante foi reportado. **Rodada final após a correção:** 28 arquivos, **253 testes passaram**; **typecheck, build de produção e 15/15 e2e passaram**. `git diff --check` passou; `db:generate` confirmou schema/migrations alinhados, sem nova alteração. A validação na cópia privada foi repetida com a migração 0010: conteúdo, datas históricas, vínculos e perfil preservados; reabertura idempotente; integridade `ok` e nenhuma FK inválida. Todos os 57 registros legados mantiveram `newsPublishedAt` nulo, sem presumir publicação recente. A cópia foi removida após a checagem.

Capturas de fixtures, apenas nesta worktree, em `.impeccable/review/`: `edition-desktop.png`, `edition-mobile.png`, `home-desktop.png`, `home-mobile.png`, entre outras. Capturas não são teste em celular físico nem prova de conteúdo real. A primeira inspeção visual corrigiu hierarquia de contexto/fontes e a quebra entre link e metadados.

Revisão independente concluída em <t3-thread://v2/362e7f6c-f945-4128-939e-88924001da04/thread:delegated-task:command%3Amcp%3A38f60511-4bd9-46d8-afe2-4c72db368788%3Adelegate-task%3Abe743545-24a9-48f2-91a0-b154544d63bc>. O achado importante foi corrigido pelo implementador com testes RED→GREEN e nova suíte integral; nenhuma revisão ficou pendente. Os ajustes de apresentação foram rechecados nos renders desktop/móvel integrados.

## Preparação da versão 0.2.1

Após a autorização de commit/push/lançamento, pacote/lockfile e padrão do Compose foram alinhados em `0.2.1`. A CI desativa o `latest` automático de semver para manter essa tag exclusiva da main. Verificação da preparação: **29 arquivos, 255 testes passaram**, typecheck e build passaram, **15/15 e2e de produção passaram**, sem API paga. A checagem documental independente não encontrou divergência material; foi esclarecido que push de branch isolado não dispara CI, enquanto a tag `v0.2.1` dispara testes e publicação. Nenhum merge ou teste/alteração no NAS está incluído nesta autorização.

A credencial GitHub local não tem `read:packages` (consulta de pacote respondeu 403) e o Docker local não está autenticado para puxar o pacote privado (401). Isso não é evidência de pacote público: a CI exige privacidade antes da publicação e consulta tags/digest/visibilidade depois usando o token do job. Não declarar publicação verificada antes da conclusão dessa execução.

## O que os testes exercitam

- Temas: IDs e nomes únicos, aliases pt/en/acentos, catálogo fechado, IA sem temas livres, média dos pesos sem inflação, frações, sinais reversíveis, auditoria e rollback/idempotência, preservação de itens/fontes/feedback/interesses/clusters/histórico, perfil sem gravação implícita.
- Agenda: 08h/16h no fuso configurado, proposta explícita de São Paulo quando falta fuso, DST, sem execução antes do horário, sem backlog, recuperação limitada, unicidade após reinício, limites separados da coleta pessoal e lease.
- Edições: seleção somente de RSS habilitados/datados na janela, ausência de fontes, atraso, novidades à tarde, IDs validados, orçamento, duas respostas inválidas contabilizadas, publicação/cache/outbox e worker real sem acionar a extensão.
- Push: VAPID pública/privada, entradas/curva/chaves/expiração, limite de aparelhos e teste, endpoints/SSRF/DNS pinado/TLS, criptografia real da biblioteca com chaves sintéticas, unicidade/claim, falha/404/410/cancelamento/lease, destinos do SW e cache offline estático. DNS/HTTPS de envio são mocks: não prova entrega real do SO.
- E2e: autenticação senha/TOTP, CSRF/Host/RSC, arquivo/edição/temas e configurações, navegação/menus, ranking/feedback e fontes pessoais, companion real com plataformas de fixture, mobile sem overflow, alvos de toque, PWA e cache sem dados pessoais.

## Escolhas e limites conhecidos

- Oito categorias amplas. Rótulo legado político sem recorte suficiente não vira Brasil/relações internacionais por adivinhação: fica em **Outros**, com original auditado. Pode ser necessário revisar esses casos no futuro; nenhum conteúdo foi apagado.
- Pesos convergem pela média dos aliases presentes, uma única vez. O ranking pode mudar como consequência deliberada da consolidação; os valores anteriores ficam auditados.
- Sem fuso explícito, a agenda geral fica desativada até a pessoa confirmar `America/Sao_Paulo` ou outro fuso.
- Atraso acima de duas horas não produz panorama velho; não há edição retroativa em massa nem retry contínuo de falhas. Falta de fontes, modelo ou saldo aparece no arquivo.
- Push é **at-most-once por tentativa**. Interrupção depois do claim pode perder o aviso. Aceite pelo provedor não prova que o SO exibiu. Não há promessa de entrega exata às 08h/16h.
- O arquivo de edições está no servidor. O aparelho não recebe cache de conteúdo pessoal para leitura offline.
- A imagem anterior `0.2.0` não contém esta evolução. O lançamento da `0.2.1` foi autorizado; instalação/teste no NAS continuam fora desse pedido. A disponibilidade da imagem depende da CI da tag concluir.

## Roteiro no celular (pendente)

Após uma versão desta evolução ser aprovada e instalada pelo usuário:

1. Faça backup online verificado antes da atualização do banco. Abra o endereço **HTTPS** correto, entre e confira **Hoje, Briefings e Temas**. Confira o fuso, as oito categorias e a separação entre briefing geral/pessoal.
2. Configure RSS públicos e `AI_BRIEFING_MODEL` sem expor chaves. Em Configurações, confirme o fuso e a agenda geral. O servidor e worker precisam permanecer ligados.
3. Configure um contato real `ORBIT_PUSH_SUBJECT` no ambiente do contêiner e reinicie. No Android, use navegador com Web Push permitido. No iOS/iPadOS 16.4+, adicione à Tela de Início e abra pelo ícone instalado.
4. Em Configurações, confirme que nenhum prompt aparece sozinho. Clique **Ativar neste aparelho**, permita e **Teste**. Feche a interface; ao tocar no aviso, deve abrir a edição correspondente ou o arquivo se ainda não houver edição. Sessão expirada deve pedir login. Tela bloqueada deve mostrar somente texto genérico.
5. Acompanhe um fechamento real às 08h e outro às 16h. Confira datas, período, fontes e novidades da tarde. Reinicie o worker depois de uma publicação: a mesma edição não deve gerar outra tentativa push. Restrições de bateria/foco/rede podem atrasar ou impedir a exibição.
6. Desative neste aparelho e confira que os próximos avisos não são enfileirados para a inscrição removida. Sem rede, deve aparecer somente a página offline estática; dados de edições não devem estar em Cache Storage.

Não executado na validação da implementação: teste em celular/NAS físico, entrega através de FCM/Mozilla/Apple, consumo de IA real ou implantação. Commit/push/lançamento da 0.2.1 foram autorizados depois; somente a CI aprovada confirma a publicação da imagem.
