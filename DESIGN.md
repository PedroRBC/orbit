---
name: Orbit
description: Curadoria pessoal local com fontes e limites transparentes
colors:
  ground: "#101521"
  surface: "#171e2c"
  rail: "#141e33"
  raised: "#1e283a"
  line: "#2b3548"
  ink: "#f0f2f8"
  muted: "#acb8cd"
  accent: "#c5b7f7"
  accent-ink: "#201637"
  success: "#8ed6b5"
  warning: "#edc78c"
  danger: "#ffa7ad"
  control-border: "#71809a"
  external-surface: "#182932"
  external-line: "#3e5961"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.65
  page-title:
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
rounded:
  control: "7px"
  panel: "8px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
---

# Design do Orbit

A leitura vem primeiro: panorama, edições e recomendações com origem e limites visíveis. Configurar fontes e preferências ou diagnosticar coletas são tarefas secundárias. Não é uma landing page nem um dashboard de métricas. Produto e escopo em PRODUCT.md; modos e contrato da superfície em docs/surface-orbit.md.

## Overview

Dark mode solicitado. Fundo azul-ardósia, navegação azul-profundo, seleção lavanda e texto claro. Tipografia de sistema para velocidade, privacidade e leitura confortável, sem downloads de fontes. Ícones Lucide com traço consistente.

## Colors

| Papel | Valor | Uso |
| --- | --- | --- |
| ground | #101521 | Fundo principal |
| surface | #171e2c | Formulários e painéis |
| rail | #141e33 | Navegação |
| raised | #1e283a | Hover e mídia sem imagem |
| line | #2b3548 | Divisores |
| ink | #f0f2f8 | Texto principal |
| muted | #acb8cd | Texto secundário |
| accent | #c5b7f7 | Ação, foco e seleção |
| accent-ink | #201637 | Texto sobre ação |
| success | #8ed6b5 | Estado saudável/concluído |
| warning | #edc78c | Configuração pendente ou operação parcial |
| danger | #ffa7ad | Erro recuperável |

## Typography

Fonte: `src/app/globals.css`. Corpo 16px/1.65; títulos de página 2.25rem (36px), 1.875rem (30px) até 760px; seções 24px; títulos de itens 20px. Escala fixa por breakpoint, sem fonte remota. Texto de briefing e edição em 15–16px/1.75, com medida de 72–74ch; contexto e metadados têm peso menor, mas continuam legíveis. Espaçamento em grupos de 8–18px e entre regiões 28–48px. Navegação, botões e feedback têm altura mínima de 44px; links no texto e nas fontes mantêm pelo menos 24px. Bordas de 1px, controles com raio de 7px, painéis de operação com 8px.

## Layout

Desktop: rail fixo de 212px, masthead discreto e conteúdo até 1280px com 48px de margem interna. Até 1100px, rail de 184px e margem de 28px. Até 760px, marca e Menu ocupam a primeira linha; Hoje, Briefings e Temas permanecem visíveis abaixo. Destinos secundários expandem no fluxo da página, sem modal. O conteúdo recebe margem de 20px e os formulários passam para uma coluna.

Navegação: Hoje (`/`), Briefings (`/briefings`) e Temas (`/temas`) são primários. Salvos (`/?lista=saved`), Fontes, Configurações, Status e Navegador são secundários. Meu perfil permanece no masthead. A marca não usa badge de plano e o cabeçalho não mostra ponto verde sem estado real. O rail suporta rolagem em janelas baixas.

A edição usa `.edition-header`, `.edition-meta`, `.edition-highlights`, `.edition-highlight`, `.edition-context` e `.edition-sources`: uma coluna de leitura, cobertura e origem explícitas. O cabeçalho agrupa os metadados com gap de 10px, sem somar a margem dos textos auxiliares. Os destaques têm títulos de 22–24px; Contexto, Por que importa e Nas fontes usam 14px, com 8–20px entre título e texto. Fontes ficam em blocos separados: link sublinhado e ícone inline, autor/data em nova linha menor. `.edition-list` separa as entradas do arquivo por linhas; `.edition-link` é apenas o link de título dentro de `h2`, não um card contendo os metadados. `.edition-empty` mantém uma orientação concreta quando falta conteúdo; `.edition-spotlight` apresenta o resumo da home com introdução de 18px (17px no celular), metadados e avisos de 13px, título e CTA. `.push-settings` e `.edition-schedule` reutilizam a linguagem dos formulários existentes.

Fora da bolha usa superfície azul-esverdeada #182932, bordas #3e5961 e rótulo textual “Fonte externa · RSS”. Notícias ficam fora dos filtros/recomendações pessoais; itens sem IA indicam trecho original. Status inclui texto de saldo e medidor nativo de uma única razão, sem gráfico categórico, com teto/saldo em tabela legível.

Briefing pessoal: coluna de leitura com tópicos separados por linhas, sem painel envolvendo outros painéis; fontes são links sublinhados e cortes por orçamento têm aviso textual. Feedback usa botões com aria-pressed e alvos de 44px, sem ações sociais externas. Meu perfil usa campos numéricos editáveis para pesos, sem gráficos decorativos.

Home vazia: introdução e sequência de configuração com ações reais. Não inventar recomendações. Home populada: filtros antes da lista; thumbnail 16:9, título, autor/data, resumo, relevância textual e justificativa. Links externos abrem com noopener/noreferrer.

Fontes: lista de canais com pausa reversível, sem exclusão destrutiva. Configuração: preferências na interface, chaves apenas no .env. Status: lista de operação e consumo, histórico tabular com rolagem horizontal no celular. Estados usam texto além de cor.

## Components

Labels ligados a inputs, navegação com aria-current, skip link e foco visível de 2px. O `main` admite foco por âncora. Menu móvel usa botão com aria-expanded/aria-controls; Escape recolhe e devolve foco ao botão. Ações têm pending/disabled, resultados com status/alert e mensagens de recuperação. Carregamento usa placeholders estáticos ocultos da árvore acessível e texto anunciado; não mostra títulos ou contagens fictícios. Vazios seguem alinhamento à esquerda, sem cards aninhados. Erro e 404 compartilham coluna de leitura e ações claras de recuperação, sem exibir exceções. Conteúdo externo é texto escapado por React. Sem animações de entrada, shimmer ou efeitos que escondam informação; transições curtas de cor, desativadas em reduced motion.

## Do's and Don'ts

Nenhuma imagem gerada, stock ou raster local de decoração. Thumbnails são URLs oficiais derivadas do ID do vídeo e carregadas pelo navegador, sem proxy/download no servidor.

## Ícones do app (PWA)

`public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `src/app/apple-icon.png` e `src/app/icon.svg` são gerados por `scripts/pwa-icons.ts`. Procedência: glifo Lucide `Orbit` (ISC), o mesmo da barra lateral, traço `--accent` (#c5b7f7) sobre `--ground` (#101521). Não são imagens geradas por IA nem decoração. O maskable mantém o glifo dentro do círculo seguro de 80%.
