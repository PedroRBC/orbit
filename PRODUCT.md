# Orbit

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Aprovado: TypeScript, Next.js App Router, Tailwind, SQLite/Drizzle e worker Node local. IA via SDK oficial do protocolo selecionado: OpenAI Compatible ou Anthropic Compatible, com URL base, chave e modelo configuráveis.

## Users

Uma pessoa acompanhando seus feeds, canais e fontes externas pelo computador ou celular. É um serviço próprio de uso pessoal, não um produto multiusuário.

## Product Purpose

Reduzir o tempo gasto escolhendo o que ler ou assistir. Recomendações devem explicar sua relevância e apontar para fontes, sem confundir popularidade no feed com importância mundial.

## Operating Context

Serviço próprio pensado para Docker, com login por senha e TOTP. Domínio, HTTPS e acesso remoto são configurados pelo usuário; não há modo alternativo sem login. Interface em português do Brasil e dark mode. Login nas plataformas é feito no navegador habitual, com uma extensão pareada ao servidor. Nenhum cookie é exportado. Instalação manual da extensão e navegador aberto são requisitos aprovados. Fontes RSS externas permanecem separadas do feed e do briefing pessoais; nenhum portal ou interesse é presumido. A direção editorial de 28/10/2026 prioriza leitura e arquivo, mantendo fontes, configuração, diagnóstico e extensão acessíveis em navegação secundária.

## Capabilities and Constraints

Canais e interesses serão cadastrados na interface, conforme resposta do usuário. Nenhum canal, preferência, notícia ou recomendação fictícia deve aparecer como real. Sem dados configurados, mostrar onboarding utilizável. Sem IA configurada, coletar metadados mas não inventar classificação. Chaves permanecem no servidor. Respostas de IA são dados não confiáveis. Cada fase termina para teste e aprovação antes da seguinte.

## Brand Commitments

Nome Orbit. Interface limpa, responsiva e escura, com lavanda para ação, foco e seleção. Hoje, Briefings e Temas formam a navegação principal; Meu perfil fica no masthead. Sem branding de plano ou indicadores de saúde presumidos. Estados vazios, de carregamento e de erro ajudam a continuar a tarefa, com ações reais e sem conteúdo de exemplo.

## Evidence on Hand

PROJETO.md é a especificação original. A conversa aprovou uma alteração: aceitar os dois protocolos de IA e endpoints personalizados. Documentação não oficial do Valete+ em https://github.com/PedroRBC/valete-plus-api. Nenhuma sessão de plataforma ou chave foi fornecida.

## Product Principles

- Mostrar os limites dos dados e da análise.
- Nenhuma ação social automática.
- Falhas isoladas e recuperáveis.
- Somente o texto necessário chega ao endpoint de IA configurado.
