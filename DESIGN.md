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
    fontSize: "15px"
    lineHeight: 1.6
  page-title:
    fontSize: "clamp(27px, 3vw, 38px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
rounded:
  control: "7px"
  panel: "10px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
---

# Design do Orbit

Interface de operação: configurar fontes e preferências, ler recomendações e diagnosticar coletas. Não é uma landing page. Produto e escopo em PRODUCT.md; contrato da superfície em docs/surface-orbit.md.

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

Fonte: `src/app/globals.css`. Corpo 15px/1.6; títulos de página responsivos 27–38px; seções 23px; títulos de itens 18px. Espaçamento em grupos de 7–12px e entre regiões 25–42px. Controles com altura mínima de 42px, bordas de 1px e raios de 7px; painéis usam 10–12px.

## Layout

Desktop: rail fixo de 224px, barra superior discreta, conteúdo até 1320px. Abaixo de 1100px o rail cai para 194px. Abaixo de 760px o rail vira navegação horizontal; formulários e conteúdo passam para uma coluna.

Fora da bolha usa superfície azul-esverdeada #182932, bordas #3e5961 e rótulo textual “Fonte externa · RSS”. Notícias ficam fora dos filtros/recomendações pessoais; itens sem IA indicam trecho original. Status inclui texto de saldo e medidor nativo de uma única razão, sem gráfico categórico, com teto/saldo em tabela legível.

Fase 2: briefing em painel azul-ardósia com tópicos em duas colunas no desktop, uma no mobile; fontes são links sublinhados e cortes por orçamento têm aviso textual. Feedback usa botões compactos com aria-pressed, sem ações sociais externas. Meu perfil usa campos numéricos editáveis para pesos, sem gráficos decorativos.

Home vazia: introdução e sequência de configuração com ações reais. Não inventar recomendações. Home populada: filtros antes da lista; thumbnail 16:9, título, autor/data, resumo, relevância textual e justificativa. Links externos abrem com noopener/noreferrer.

Fontes: lista de canais com pausa reversível, sem exclusão destrutiva. Configuração: preferências na interface, chaves apenas no .env. Status: lista de operação e consumo, histórico tabular com rolagem horizontal no celular. Estados usam texto além de cor.

## Components

Labels ligados a inputs, navegação com aria-current, skip link e foco visível de 2px. Ações têm pending/disabled, resultados com status/alert e mensagens de recuperação. Conteúdo externo é texto escapado por React. Sem animações de entrada que escondam informação; transições curtas de cor, desativadas em reduced motion.

## Do's and Don'ts

Nenhuma imagem gerada, stock ou raster local de decoração. Thumbnails são URLs oficiais derivadas do ID do vídeo e carregadas pelo navegador, sem proxy/download no servidor.

## Ícones do app (PWA)

`public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `src/app/apple-icon.png` e `src/app/icon.svg` são gerados por `scripts/pwa-icons.ts`. Procedência: glifo Lucide `Orbit` (ISC), o mesmo da barra lateral, traço `--accent` (#c5b7f7) sobre `--ground` (#101521). Não são imagens geradas por IA nem decoração. O maskable mantém o glifo dentro do círculo seguro de 80%.
