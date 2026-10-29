# Catálogo de temas

Os temas são categorias amplas de classificação, não manchetes nem os agrupamentos de `topics` do briefing. `processed_items.theme` e as chaves de `interest_profile.weights` guardam IDs do catálogo persistido. A interface carrega um mapa de rótulos por render; não normaliza os pesos canônicos novamente.

A evolução v2 está **em desenvolvimento, não publicada** sobre a base `0.2.2`. A [especificação aprovada](superpowers/specs/2026-10-28-briefings-push-themes-design.md) substitui o catálogo fechado. Faça backup verificado antes de atualizar um banco real; voltar à imagem `0.2.2` depois da v2 exige restaurar o backup anterior.

## Oito sementes, não um catálogo fechado

| ID estável | Nome | Recorte |
| --- | --- | --- |
| `politica-interna` | Política do Brasil | Governo, eleições, partidos e instituições do Brasil. Política interna permanece como alias. |
| `politica-externa` | Política externa | Relações entre países, diplomacia e geopolítica; mencionar outro país não basta. |
| `tecnologia` | Tecnologia | IA, programação, software, hardware, redes, suporte e inovações no Brasil e no mundo. |
| `ciencia-saude` | Ciência e saúde | Pesquisa científica, meio ambiente, medicina e saúde. |
| `economia-trabalho` | Economia e trabalho | Economia, finanças, negócios, emprego e carreira. |
| `sociedade-cotidiano` | Sociedade e cotidiano | Vida cotidiana, comportamento, educação, mobilidade e animais; sem aliases automotivos. |
| `cultura-lazer` | Cultura e lazer | Artes, jogos, entretenimento, esportes, viagens e lazer. |
| `outros` | Outros | Conteúdo sem contexto suficiente ou fora dos demais temas. |

`SEED_THEMES` em `src/lib/taxonomy.ts` define rótulos e descrições das sementes. `listThemes`, `themeLabels` e `resolveTheme` consultam o catálogo do banco, incluindo temas criados. Os exports estáticos `TAXONOMY`, `themeSchema`, `normalizeTheme` e `themeLabel` são compatibilidade legada, não a fonte dos consumidores atuais.

A v2 retira de Sociedade e cotidiano os aliases `Automóveis`, `Aluguel de carros`, `Coleção de carros`, `Oficina automotiva`, `Carros` e `Cars`. O mapa `LEGACY_TAXONOMY` e a consolidação v1 continuam congelados: não reinterpretam o histórico a cada inicialização.

## Classificação e recorrência

A IA recebe o catálogo na mensagem de usuário, como dado: sementes com descrição, temas criados com ID/rótulo e **até 20 grupos em observação mais recentes**. Devolve um ID existente em `theme` e pode propor `newTheme: { label, aliases? }` para uma área ampla que ainda não cabe no catálogo. Não deve criar um tema por pessoa, acontecimento, manchete ou ano.

- Só itens pessoais distintos e sem spam contam. Notícias RSS e spam não propõem temas.
- `themeKey` normaliza acentos, caixa, pontuação e plural simples. A correspondência é exata depois dessa normalização, nunca por inclusão de palavras ou nova chamada de IA.
- Rótulo que coincide com ID/rótulo/alias existente usa esse tema. Aliases de propostas não roubam aliases de outros temas; os já pertencentes ao catálogo são descartados. Propostas restantes conectadas por rótulo ou alias normalizado formam um grupo.
- Com **três itens pessoais distintos** no grupo e menos de **40 temas no catálogo, incluindo sementes**, o worker cria um tema `origin = 'ai'`, ID slug ASCII e rótulo mais frequente por forma normalizada. Empates preservam a primeira grafia; colisões de slug recebem sufixo. Aliases válidos para associação são reunidos sem duplicação.
- O grupo muda para o tema criado, com auditoria; suas propostas são removidas. Rótulos originais em `taxonomy_item_audit` também podem ser reaproveitados por coincidência normalizada exata, somente se o item ainda estiver no tema atribuído pela v1. Isso pode mover itens pessoais ou notícias, mas não remapeia pesos.
- Não há janela de tempo nem expiração de propostas. Com 40 temas, elas continuam registradas, sem promoção até liberar espaço.
- Novos rótulos têm 2–40 caracteres, até quatro palavras, sem dígitos e com slug não vazio. Proposta inválida é ignorada, sem derrubar o lote.
- Na segunda resposta inválida do lote, um `theme` desconhecido é resolvido por rótulo/alias atual ou vira `outros`, em vez de travar a fila. Classificações concluídas não são reenviadas por mudança de catálogo ou perfil.

Propostas, promoção, reaproveitamento e persistência do lote acontecem na mesma transação `owned()`/IMMEDIATE, com verificação de lease. `src/lib/themes.ts` implementa essas operações.

## Interface e reparo

- `/temas` mostra as sementes, temas criados com data e contagem de itens **pessoais ativos e sem spam**, e grupos **Em observação**, com N de 3 itens. Atingir 40 mostra o limite e orienta juntar temas.
- Cada tema criado permite **Juntar a outro tema**, inclusive Outros. A ação autenticada move todos os itens, audita, combina pesos pela média quando ambos existem (ou transfere o único peso), reúne rótulo/aliases no destino e apaga a origem. Sementes não podem ser removidas. Toda a operação é IMMEDIATE e reverte em caso de falha.
- `/perfil#temas` e o filtro da Home usam o catálogo inteiro do banco, mesmo para temas sem itens pessoais. Campos sem peso mostram zero sem gravar preferência; ajustes aceitam números finitos e frações entre -20 e 20. O formulário submete o ID exato; tema desconhecido gera erro próprio. Filtro desconhecido volta a todos, sem virar Outros silenciosamente.

## Consolidação e integração

`openDatabase` aplica as migrations Drizzle e chama, nesta ordem, `consolidateTaxonomy(db)` (v1) e `consolidateThemeCatalog(db)` (v2). Cada helper abre sua própria transação SQLite **IMMEDIATE**; não deve ser chamado dentro de outra. Foreign keys e `busy_timeout` permanecem habilitados. Não há migração Drizzle concorrente para essas tabelas.

A v1 converte rótulos e pesos legados, conserva os originais e valida o resultado antes do marcador. Rótulos ambíguos/desconhecidos vão para Outros com auditoria, sem inferir contexto do conteúdo. Pesos equivalentes convergem pela média uma única vez. JSON/pesos inválidos, inclusive chaves duplicadas, abortam e revertem a consolidação. Reabrir retorna `applied: false`, sem recalcular feedback posterior.

A v2 acrescenta `origin`, `aliases` JSON e `created_at` ao catálogo, atualiza sementes/aliases e troca os triggers do catálogo na mesma transação. Seu marcador próprio `taxonomy_catalog_consolidations` tem `CHECK (version = 2)`. Falha reverte DDL, dados, triggers e marcador. O consolidado v1 e suas auditorias não são apagados.

## Dados e auditoria

| Tabela | Conteúdo |
| --- | --- |
| `taxonomy_themes` | ID, rótulo, origem `seed`/`ai`, aliases JSON e data de criação. |
| `taxonomy_consolidations` | Marcador v1 e contagens iniciais da conversão de itens/pesos. |
| `taxonomy_item_audit` | Tema original, tema mapeado, tipo de mapeamento e horário da v1; inserções novas em sementes também são auditadas, sem sobrescrever o original. |
| `taxonomy_profile_audit` | JSON exato de pesos anterior e JSON consolidado inicial por perfil. |
| `taxonomy_weight_audit` | Cada peso original, destino, média e mapeamento v1. |
| `taxonomy_catalog_consolidations` | Marcador v2 e horário de conclusão. |
| `theme_proposals` | Uma proposta por `raw_id`, rótulo/chave normalizada, aliases e horário. |
| `taxonomy_reassignments` | Item, tema anterior, destino, motivo `proposal`, `legacy_label` ou `merge`, e horário. |

Triggers preservam as sementes e bloqueiam mudanças de ID, rótulo ou origem. Só permitem inserir temas `ai` com ID ASCII válido e apagar um tema `ai` sem itens. Temas de itens e chaves dos pesos precisam pertencer ao catálogo; pesos devem ser objeto JSON com chaves únicas e números finitos. Novas classificações em temas `ai` não criam vínculo de auditoria v1 que impediria sua posterior junção/remoção; movimentações v2 ficam em `taxonomy_reassignments`.

Consolidações e reparos preservam conteúdo, URLs, vínculos de fontes, score, modelos, timestamps, clusters, briefings, feedback e interesses/exclusões livres. Movem apenas temas/pesos previstos e acrescentam auditoria. Não há reclassificação paga nem limpeza automática dos pesos históricos afetados por RSS.

Consultas somente leitura:

```sql
SELECT * FROM taxonomy_consolidations;
SELECT * FROM taxonomy_catalog_consolidations;
SELECT id, label, origin, aliases, created_at FROM taxonomy_themes;
SELECT * FROM taxonomy_item_audit WHERE mapping = 'fallback';
SELECT * FROM taxonomy_reassignments ORDER BY id;
SELECT p.rawId, p.theme
FROM processed_items p LEFT JOIN taxonomy_themes t ON t.id = p.theme
WHERE t.id IS NULL;
PRAGMA foreign_key_check;
```

O último SELECT e `foreign_key_check` devem vir vazios. Para downgrade à `0.2.2`, pare o app e restaure o backup **anterior à v2** antes de voltar a imagem; trocar só a tag não reverte o esquema. Dados posteriores ao backup se perdem. Veja [implantação e rollback](deploy.md#limites-do-rollback).

## Pesos e feedback

A média v1 inclui zeros presentes e preserva negativos/frações; aliases ausentes não contam como zero. Exemplo: `IA aplicada a código: 6`, `Hardware: 3`, `Technology: 0` viram `tecnologia: 3`, não 9. O JSON original e as parcelas ficam auditados. Um perfil sem pesos continua `{}`.

Depois da consolidação, sinais pessoais atualizam o ID atual: Gostei ±3, salvar ±1 e primeiro clique +1; desfazer reverte o delta e cliques repetidos não acumulam. Não se divide o feedback por aliases históricos. O total armazenado pode passar de -20/20 para preservar reversibilidade; só exibição/ranking/prompts limitam o valor. Ajuste manual redefine o ponto de partida. Feedback em RSS continua registrado, mas **não altera pesos pessoais**; pesos antigos não são limpos nesta evolução.

Testes sintéticos: `tests/taxonomy.test.ts`, `tests/taxonomy-catalog.test.ts`, `tests/theme-proposals.test.ts`, `tests/taxonomy-profile.test.ts`, `tests/taxonomy-actions.test.ts`, `tests/feedback.test.ts`, `tests/ai.test.ts`, `tests/pipeline.test.ts` e e2e de catálogo/perfil/filtros/junção. SQLite isolado e endpoints locais, sem serviço pago.
