# Orbit

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Aprovado: TypeScript, Next.js App Router, Tailwind, SQLite/Drizzle e worker Node local. IA via SDK oficial do protocolo selecionado: OpenAI Compatible ou Anthropic Compatible, com URL base, chave e modelo configuráveis.

## Users

Uma pessoa usando seu próprio computador para acompanhar conteúdo que seus feeds e canais mostram. Não é um produto multiusuário.

## Product Purpose

Reduzir o tempo gasto escolhendo o que ler ou assistir. Recomendações devem explicar sua relevância e apontar para fontes, sem confundir popularidade no feed com importância mundial.

## Operating Context

Servidor em localhost por padrão. Acesso pelo celular exige ativação explícita. Interface em português do Brasil e dark mode, conforme PROJETO.md. Fases 1–4 autorizadas: YouTube RSS/home, X, Instagram, Valete+, configuração, recomendações, briefing, tópicos, feedback, perfil e status. Login nas plataformas é feito no navegador habitual, com uma extensão local pareada. Nenhum cookie é exportado. Instalação manual da extensão e navegador aberto são requisitos aprovados pelo usuário. A fase 5 foi autorizada: fontes RSS externas claramente separadas, agenda local e painel de custo. Nenhum portal/interesse é presumido.

## Capabilities and Constraints

Canais e interesses serão cadastrados na interface, conforme resposta do usuário. Nenhum canal, preferência, notícia ou recomendação fictícia deve aparecer como real. Sem dados configurados, mostrar onboarding utilizável. Sem IA configurada, coletar metadados mas não inventar classificação. Chaves permanecem no servidor. Respostas de IA são dados não confiáveis. Cada fase termina para teste e aprovação antes da seguinte.

## Brand Commitments

Nome Orbit. Interface limpa, responsiva e escura. Navegação previsível e estados vazios com ações concretas.

## Evidence on Hand

PROJETO.md é a especificação original. A conversa aprovou uma alteração: aceitar os dois protocolos de IA e endpoints personalizados. Documentação não oficial do Valete+ em https://github.com/PedroRBC/valete-plus-api. Nenhuma sessão de plataforma ou chave foi fornecida.

## Product Principles

- Mostrar os limites dos dados e da análise.
- Nenhuma ação social automática.
- Falhas isoladas e recuperáveis.
- Somente o texto necessário chega ao endpoint de IA configurado.
