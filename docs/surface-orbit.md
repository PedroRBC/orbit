# Orbit — leitura e organização

Modo: Read na leitura e no arquivo; Operate nos ajustes, nas fontes e no diagnóstico.

## Direction contract

THESIS: leitura antes da operação. Hoje apresenta o briefing pessoal, com até três notícias RSS externas identificadas como complemento, e as recomendações pessoais; Briefings dá acesso ao arquivo de edições gerais e à geração sob demanda; Temas apresenta oito sementes, temas criados após três itens pessoais distintos (até 40 no catálogo), grupos em observação e junção de temas criados; interesses e pesos ficam em Meu perfil. Origem, cobertura e limites são parte da leitura, sem métricas decorativas.

OWN-WORLD: preservar a estante de fichas de leitura noturna. Fundo azul-ardósia, rail azul profundo, texto claro e seleção lavanda suave. Tipografia de sistema, sem requisições de fontes. Lucide, bordas finas e controles familiares. Sem vidro, glow, gradientes, sombras decorativas ou imagens geradas.

STORY: abrir Hoje, entender o recorte disponível, consultar uma edição ou sua fonte original e voltar à leitura. Salvos, fontes, configuração, consumo e extensão estão na navegação secundária; o perfil permanece no masthead. Primeiro uso e ausência de dados mostram o próximo passo real, sem conteúdo fictício.

FIRST VIEWPORT: rail desktop de 212px (184px em telas intermediárias), marca sem badge de plano e masthead discreto com link Meu perfil. Conteúdo limitado a 1280px; texto de edição e briefing pessoal em coluna de até 72–74ch. Título de página 36px, 30px no celular, com respiro entre regiões. Edições e tópicos são separados por regras, não por cards aninhados.

MOBILE: até 760px, marca e botão Menu dividem a primeira linha; Hoje, Briefings e Temas permanecem visíveis abaixo. Menu expande os destinos secundários no fluxo, sem overlay nem bloqueio de foco. O botão informa `aria-expanded` e `aria-controls`; Escape recolhe e devolve foco ao botão. Selecionar um destino também recolhe o menu. Navegação e ações principais têm alvo mínimo de 44px; fontes e links no texto mantêm pelo menos 24px.

STATES: loading usa texto anunciado e placeholders estáticos, sem notícias fictícias ou shimmer. Vazios ficam alinhados à leitura e oferecem ações existentes. Erro de página oferece nova tentativa e retorno ao início, sem expor detalhes de exceção; 404 oferece retorno. O skip link continua disponível, e o conteúdo principal recebe foco por âncora.

FORM: refinamento editorial da direção de fichas de leitura, aprovado em 28/10/2026. A direção original foi o candidato 3, seed:52f243ce0a47f20b, selecionado em 27/10/2026 por `impeccable concept-seed --scope direction --mode operate`. Não abrir nova rodada de perguntas ou aprovação visual.

## Contratos de integração

- Navegação em `src/app/navigation.tsx`; `components.tsx` preserva a reexportação anterior. Hoje é `/`, Briefings é `/briefings`, incluindo suas páginas de detalhe; Temas é `/temas`, com links para os filtros pessoais. `/perfil#temas` mantém os ajustes de preferências fora da navegação editorial principal.
- Salvos usa o filtro existente `/?lista=saved`; Hoje continua sendo a página corrente nesse subrecorte. O próprio filtro indica a seleção da lista. Fontes, Configurações, Status e Navegador levam às rotas existentes; Navegador é também o caminho para instalar e parear a extensão.
- `.edition-header` agrupa título e cobertura com gap de 10px e sem margem extra em `.field-help`. `.edition-meta` em `p` mantém fluxo inline para texto e `time`; em `dl`, organiza pares `dt`/`dd` com flex. `.edition-highlights` limita a leitura e separa o primeiro destaque da introdução por 32px. Só o `h2` direto de `.edition-highlight` recebe tamanho de título; os `h3` de `.edition-context` e `.edition-sources` usam 14px e espaçamento próprio.
- `.edition-sources` é um bloco com `h3` e um `p` por fonte; o `p` contém `a` com SVG inline e `span.field-help` em nova linha para autor/data. Fontes sucessivas recebem 16px de separação, sem flex entre título e autoria.
- `.edition-list` contém `section` por entrada do arquivo; a linha divisória e o padding pertencem à seção. `.edition-link` é o link dentro do `h2`, com seta ao lado; metadados e contexto ficam nos parágrafos seguintes. `.edition-empty` apresenta indisponibilidade e ações concretas. `.edition-spotlight` é o resumo na home: introdução sem classe em 18px/17px no celular, título, CTA e textos auxiliares menores, sem superfície adicional aninhada.
- `.push-settings` e `.edition-schedule` organizam as novas regiões de configuração, reutilizando formulários, botões e estados do app; não implementam comportamento por CSS.

FINISH: revisar o resultado integrado em desktop e celular, incluindo menu, teclado, foco, estados e conteúdo longo. A implementação do shell não substitui essa verificação renderizada. DESIGN.md registra os valores do código; o sidecar antigo não é reparado como efeito colateral desta entrega. Não há raster novo a documentar.
