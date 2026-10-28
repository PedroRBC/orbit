https://github.com/PedroRBC/valete-plus-api, use essa documentacao que fiz do ValetePlus

# ALTERAÇÕES APROVADAS EM 27/10/2026

- A integração de IA deve aceitar OpenAI Compatible ou Anthropic Compatible, com URL base, chave de API e modelos configuráveis. Não há obrigação de usar o serviço Anthropic; referências abaixo à Anthropic são a proposta original.
- Canais do YouTube e interesses iniciais serão cadastrados na interface, sem valores presumidos.
- Arquitetura e fase 1 foram aprovadas. Após a entrega e testes da fase 1, o usuário autorizou explicitamente a fase 2. Após a entrega da fase 2, o usuário autorizou explicitamente a fase 3. Após a entrega da fase 3, o usuário autorizou explicitamente a fase 4. Após a entrega da melhoria de login por extensão, o usuário autorizou explicitamente a fase 5. Ao final dela, parar para o teste final do usuário.

- Alteração de login aprovada: usar extensão local no navegador habitual (Helium), sem Chromium automatizado para login, sem cookies exportados e com pareamento local. Essa melhoria não autoriza a fase 5.

# MISSÃO

Use todas as Skills de Construcao e Desgin e Crie um app web pessoal chamado "Orbit" que roda localmente na minha máquina (localhost) e funciona como meu curador pessoal de conteúdo e notícias. Ele coleta o que meus algoritmos (YouTube, X, Instagram e ValetePlus) estão me mostrando, usa IA via API para filtrar, resumir e ranquear, e quando eu abro o app me entrega um panorama do que está acontecendo no mundo, segundo o MEU algoritmo, mais recomendações do que vale a pena eu ver.

Antes de escrever qualquer código: leia este prompt inteiro, me faça no máximo 5 perguntas objetivas sobre pontos ambíguos (veja "Perguntas iniciais") e apresente um plano de arquitetura e fases para eu aprovar.

# O QUE O APP FAZ

1. COLETA (em segundo plano, agendada)
   - YouTube: (a) vídeos recomendados da minha home, (b) vídeos novos dos canais que escolho acompanhar.
   - X (Twitter): posts da aba "Para você" da minha conta.
   - Instagram: posts do meu feed.
   - ValetePlus: posts/conteúdos do feed da minha conta. Não conheço a estrutura desse site, então me pergunte a URL e como o feed funciona, e depois inspecione a página para construir o coletor.

2. PROCESSAMENTO COM IA (via API da Anthropic)
   - Remover duplicatas e spam/anúncios.
   - Classificar cada item por tema, tom, idioma e tipo (notícia, opinião, entretenimento, educação, meme etc.).
   - Dar uma nota de "relevância pra mim" (0–100) com uma justificativa de uma linha, baseada no meu perfil de interesses.
   - Agrupar itens de plataformas diferentes que falam do mesmo assunto, formando "tópicos do momento".
   - Para vídeos longos, resumir usando a transcrição quando disponível (legendas do YouTube).

3. TELA INICIAL (o que vejo ao abrir)
   - "Briefing do dia": texto curto (leitura de 1 a 2 minutos) explicando o que está acontecendo no mundo segundo meu algoritmo, com os 5–8 tópicos principais e quais plataformas estão falando de cada um.
   - "Vale a pena ver": lista ranqueada de vídeos, posts e canais com thumbnail, fonte, resumo em 2 linhas, motivo da recomendação e tempo estimado.
   - "Fora da bolha": 2–3 itens que meu algoritmo provavelmente NÃO está me mostrando, mas que são relevantes pelo noticiário geral, para eu não ficar preso numa bolha. Sinalize claramente que esta seção vem de fonte externa (ex.: RSS de portais de notícias que eu configurar).
   - Filtros por plataforma, tema e período. Botões de 👍 / 👎 / "salvar pra depois" / "já vi" em cada item.

4. APRENDIZADO
   - Meus 👍/👎 e cliques atualizam um perfil de interesses (guardado no banco e visível/editável numa página "Meu perfil"), e esse perfil entra no prompt de ranqueamento.

# STACK (pode propor melhoria justificando)

- TypeScript em tudo. Next.js (App Router) + Tailwind para a interface.
- SQLite com Drizzle ORM (ou Prisma) para persistência local.
- Um worker separado (processo Node) com agendador (node-cron) para as coletas e o processamento de IA.
- Playwright para coletores que precisam do navegador, usando um perfil persistente e local, no qual eu faço login manualmente uma vez.
- Anthropic API (SDK oficial) com a chave em .env (nunca no código, nunca commitada). Modelos configuráveis por variável de ambiente: modelo barato e rápido (Haiku) para classificação em lote, modelo mais capaz (Sonnet) para o briefing e a justificativa final. Confirme os model strings atuais na documentação oficial antes de usar.
- Visual: dark mode por padrão, limpo, responsivo (preciso conseguir abrir no celular pela rede local).

# REGRAS DOS COLETORES (importante)

- Cada plataforma é um "coletor" plugável com a mesma interface (collect() -> RawItem[]), para eu poder adicionar ou remover fontes depois.
- Prefira SEMPRE a via oficial ou estável quando existir:
  * YouTube canais: RSS do canal ou YouTube Data API (chave gratuita), não scraping.
  * YouTube home recomendada, X "Para você" e Instagram: não há API oficial para isso, então use automação do navegador local (Playwright) com a minha sessão logada, em modo somente leitura.
- Comportamento educado e seguro: modo somente leitura (nunca curtir, seguir, comentar ou postar), scroll lento com delays aleatórios, poucas execuções por dia (padrão: 3x/dia, configurável), limite de itens por execução, nada de paralelismo agressivo. Sem burlar captcha ou verificação; se aparecer, o coletor para e me avisa na interface.
- Cada coletor deve falhar de forma isolada: se um quebrar (mudança de layout), os outros continuam, o erro aparece no painel de status com data/hora e o motivo, e o app segue funcionando com os dados já coletados.
- Seletores de DOM ficam isolados num arquivo por plataforma, para eu conseguir corrigir fácil quando a plataforma mudar o layout.
- Guarde apenas o necessário: título, texto/legenda, autor, URL, thumbnail (URL), data, métricas visíveis e plataforma. Não armazene dados de terceiros além disso, e não faça download de mídia.
- Inclua no README um aviso honesto: automatizar essas plataformas pode violar os termos de uso delas e há risco (baixo, mas real) de bloqueio da conta. Por isso o app é de uso estritamente pessoal, local e em baixa frequência.

# PIPELINE DE IA

- Processar em lotes (batch) para economizar tokens; usar prompt caching onde fizer sentido.
- Saídas estruturadas em JSON validado (zod), com retry em caso de resposta inválida.
- Cache por item: nunca reprocessar o mesmo item duas vezes.
- Controle de custo: variável de ambiente com teto diário de gasto/tokens; ao atingir, o worker pausa a IA e mostra o aviso na interface. Mostre uma estimativa de custo diário no painel.
- Prompts ficam em arquivos separados (/prompts), fáceis de editar.
- O briefing deve ser honesto: indicar quando algo é apenas "o que meu feed está mostrando" e não necessariamente o que é mais importante no mundo. Nada de afirmar fatos que não estejam nos itens coletados; sempre linkar as fontes.
- Idioma da saída: português do Brasil.

# DADOS

Tabelas mínimas: sources, raw_items, processed_items (tema, nota, justificativa, resumo, cluster_id), topics (clusters), feedback, interest_profile, briefings, collector_runs (status, erros, duração), settings.

# SEGURANÇA E PRIVACIDADE

- Tudo local. Nenhum dado enviado para serviços além da API de IA (somente o texto necessário para análise).
- .env e o perfil do navegador no .gitignore.
- Sem login/multiusuário, mas o servidor deve escutar apenas em localhost por padrão (acesso pelo celular só se eu ativar explicitamente).

# FASES DE ENTREGA (faça uma por vez e pare para eu testar)

Fase 1: Estrutura do projeto, banco, interface base e painel de status. Coletor de YouTube por RSS (canais) com IA classificando e ranqueando. Tela inicial com "Vale a pena ver".
Fase 2: Briefing do dia + agrupamento de tópicos + feedback 👍/👎 + página "Meu perfil".
Fase 3: Coletor da home do YouTube (Playwright) e coletor do X.
Fase 4: Coletores do Instagram e ValetePlus.
Fase 5: "Fora da bolha" (RSS de notícias), agendamento, controle de custo, polimento visual e README completo.

# PERGUNTAS INICIAIS (me faça antes de começar)

- URL e funcionamento do ValetePlus (e se exige login).
- Lista de canais do YouTube para acompanhar (ou como importar minhas inscrições).
- Meus principais interesses e o que eu NÃO quero ver (para o perfil inicial).
- Sistema operacional e se a máquina fica ligada o dia todo (define o agendamento).
- Se prefiro rodar só no PC ou também acessar pelo celular.

# COMO TRABALHAR

- Código limpo, tipado e comentado onde não for óbvio. Rode e teste cada fase antes de me entregar.
- Crie um CLAUDE.md na raiz com a arquitetura, comandos e convenções, e mantenha atualizado.
- Se algo for inviável ou arriscado, diga claramente e proponha alternativa em vez de improvisar.