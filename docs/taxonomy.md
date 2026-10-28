# Taxonomia controlada

Os temas da classificação são categorias amplas, não os assuntos específicos do briefing. `processed_items.theme` e as chaves de `interest_profile.weights` passam a guardar IDs do catálogo. Os nomes humanos são obtidos por `themeLabel()`.

## Catálogo v1

| ID estável | Nome | Recorte e exemplos de aliases |
| --- | --- | --- |
| `politica-interna` | Política interna | Brasil: eleições, partidos, governo e instituições. `Política brasileira`, `Brazilian politics`, `Renan Santos e eleições`, `Votos nulos`. |
| `politica-externa` | Política externa | Relações internacionais, diplomacia e geopolítica. `Relações internacionais`, `International relations`, `Geopolítica`. |
| `tecnologia` | Tecnologia | Uma categoria para IA, programação, software, hardware e suporte. `IA aplicada a código`, `Programação e auditoria`, `Processadores`, `Mensageria descentralizada`, `Suporte técnico`, `Technology`. |
| `ciencia-saude` | Ciência e saúde | Ciência, pesquisa, medicina e saúde. `Ciência`, `Science and health`, `Saúde`. |
| `economia-trabalho` | Economia e trabalho | Economia, finanças, emprego e carreira. `Dívida dos EUA`, `Ações e Zona Franca de Manaus`, `Relato de trabalho`, `Trabalho noturno`. |
| `sociedade-cotidiano` | Sociedade e cotidiano | Vida diária, comportamento, mobilidade, automóveis e animais. `Automóveis`, `Animais`, `Daily life`. |
| `cultura-lazer` | Cultura e lazer | Cultura, jogos, entretenimento, esportes e lazer. `Cultura e jogos`, `Gaming`, `Cinema`. |
| `outros` | Outros | Rótulos não reconhecidos ou sem contexto suficiente. |

O catálogo completo, incluindo aliases, é `TAXONOMY` em `src/lib/taxonomy.ts`. IDs e nomes são únicos. O catálogo persistido é fechado por triggers de INSERT/UPDATE/DELETE; uma mudança futura exige migração deliberada, não um novo rótulo vindo de formulário ou IA.

Oito categorias cobrem os grupos identificados sem recriar a fragmentação anterior. Automóveis e animais ficam em Sociedade e cotidiano; jogos ficam em Cultura e lazer. Não há categorias distintas para cada pessoa, eleição, ferramenta, profissão ou componente de computador.

`normalizeTheme()` aceita IDs, nomes e aliases explícitos em português/inglês, ignorando caixa, acentos, espaços e separadores. Não procura palavras soltas em rótulos arbitrários nem consulta IA. Rótulos ambíguos como `Mundo` ou `Política` não autorizam inferir um recorte: a migração os coloca em Outros e registra o original como fallback. Novos ajustes manuais de peso com rótulo desconhecido são recusados, não criam um alias para Outros. Interesses e exclusões continuam como texto livre original.

Os nomes legados foram consultados exclusivamente com `SELECT DISTINCT theme FROM processed_items` em conexão readonly/query-only, sem leitura dos itens ou de `.env`. Entre os aliases observados adicionais estão `Hardware e desempenho de PC` → Tecnologia, `Relato profissional` → Economia e trabalho, `Aluguel de carros`/`Coleção de carros`/`Oficina automotiva`/`Animais de estimação` → Sociedade e cotidiano e `Mercado de jogos`/`Filme ligado a Renan`/`Reação humorística` → Cultura e lazer. Os aliases políticos que nomeiam Renan Santos ou Dilma entram em Política interna; `Internacionalização e política` entra em Política externa.

Não há base apenas no rótulo para inferir Brasil em `Crítica política`, `Polarização política`, `Política e saúde` ou `Apoio político`, nem relações internacionais em `Debate entre japoneses e franceses`. Esses casos, assim como `Lista de nomes`, `Saudação`, `Elogio a Kim` e outros rótulos sem contexto suficiente, ficam em Outros com o original auditado. Esta política conservadora pode aumentar Outros; não há reclassificação paga nem consulta ao conteúdo para resolver ambiguidades.

A IA recebe o catálogo gerado pelo código no system prompt e precisa devolver um ID exato. `themeSchema` rejeita inclusive os aliases humanos, acionando o retry já existente. Após duas respostas inválidas, a pendência é preservada. Itens já classificados não são enviados novamente à IA por causa da consolidação.

## Integração

O helper é o responsável por todo o DDL e pela conversão; não há migração Drizzle concorrente para copiar ou gerar. Em `openDatabase`, depois das migrations atuais e antes de retornar a conexão:

```ts
import { consolidateTaxonomy } from "./taxonomy";

migrate(db, { migrationsFolder: resolve("drizzle") });
consolidateTaxonomy(db);
return db;
```

Assinatura:

```ts
consolidateTaxonomy(db: { $client: Sqlite.Database }): {
  version: 1;
  applied: boolean;
  items: number;
  profiles: number;
  fallbackItems: number;
  fallbackWeights: number;
}
```

- Executar somente depois das migrations normais e com foreign keys habilitadas. Não chamar dentro de outra transação.
- O helper usa uma transação SQLite `IMMEDIATE`: DDL, auditoria, conversão, verificação, triggers e marcador final são atômicos.
- Se qualquer JSON/peso legado for inválido (inclusive chaves duplicadas, que JSON.parse sozinho descartaria), ou uma escrita/verificação falhar, lança erro e reverte tudo. `openDatabase` deve propagar o erro, sem servir um banco parcialmente migrado.
- `taxonomy_consolidations.version = 1` é o marcador. Chamadas posteriores retornam `applied: false` e as contagens da primeira execução, sem recalcular médias nem alterar feedback posterior. Duas conexões ficam serializadas pelo lock SQLite e pelo `busy_timeout` configurado em `openDatabase`.
- Testes de dados legados devem abrir SQLite e executar somente as migrations Drizzle antes de montar a fixture; então chamam o helper explicitamente. Novas fixtures que usam `openDatabase` devem usar IDs canônicos.

Integrações de interface/ações:

- Formulários submetem o ID; labels e filtros exibem `themeLabel(id)`. Meu perfil tem a âncora `/perfil#temas` e mostra os oito temas com suas descrições, mesmo sem perfil/pesos. Um campo sem peso salvo exibe `0`, mas a renderização não grava pesos nem presume preferências.
- Queries de tema normalizam parâmetros antigos com `normalizeTheme()`. Um filtro desconhecido não deve ser convertido silenciosamente em Outros: o chamador decide entre erro ou ausência de filtro.
- `learnedWeights()` e `rankingExpression()` normalizam aliases de pesos pela mesma média. A persistência já consolidada permite comparar `processed_items.theme` diretamente pelo ID.
- `updateTopicWeight()` normaliza aliases conhecidos e recusa temas desconhecidos. Aceita número finito entre -20 e 20, inclusive frações. A Server Action correspondente precisa remover a restrição `.int()`; o input de Meu perfil usa `step="any"`.
- `src/app/(app)/outside.tsx` também deve usar `themeLabel()` ao exibir a classificação. O nome do tema não é o ID/título de `topics`.

## Dados e auditoria

O SQL exato de tabelas/triggers está em `src/db/taxonomy.ts`; é executado pelo próprio helper na transação acima.

| Tabela | Conteúdo |
| --- | --- |
| `taxonomy_themes` | `id` (PK), `label` (UNIQUE); os oito registros fixos. |
| `taxonomy_item_audit` | `raw_id` (PK/FK para raw_items), `original_theme`, `theme_id` (FK para catálogo), `mapping` (`canonical`, `alias` ou `fallback`), `consolidated_at`. |
| `taxonomy_profile_audit` | `profile_id` (PK/FK), `original_weights` (JSON exato anterior), `mapped_weights` (JSON consolidado inicial), `consolidated_at`. |
| `taxonomy_weight_audit` | PK (`profile_id`, `original_theme`), `original_weight`, `theme_id`, `mapped_weight`, `mapping`. O valor mapeado é a média inicial da categoria. |
| `taxonomy_consolidations` | `version`, `completed_at`, `item_count`, `profile_count`, `fallback_item_count`, `fallback_weight_count`. |

A consolidação altera somente `processed_items.theme` e `interest_profile.weights`. Preserva IDs, texto, URLs, vínculos de fontes, score, modelo, timestamps, `clusterId`, `topics`, briefings, feedback, interesses/exclusões livres e histórico de execução/consumo. A auditoria não substitui nem apaga os originais. Um trigger também registra o ID original de novas classificações; recadastrar a classificação de um item não sobrescreve sua primeira auditoria.

Triggers recusam INSERT/UPDATE com tema fora do catálogo. Pesos persistidos precisam ser um objeto JSON com chaves canônicas únicas e valores numéricos finitos, não arrays, strings ou chaves livres. Totais armazenados podem ultrapassar -20/20 para manter a reversibilidade; só exibição, ranking e prompts usam o limite.

Consultas de verificação, somente leitura:

```sql
SELECT * FROM taxonomy_consolidations;
SELECT * FROM taxonomy_item_audit WHERE mapping = 'fallback';
SELECT * FROM taxonomy_weight_audit ORDER BY profile_id, theme_id, original_theme;
SELECT p.rawId, p.theme
FROM processed_items p LEFT JOIN taxonomy_themes t ON t.id = p.theme
WHERE t.id IS NULL;
PRAGMA foreign_key_check;
```

O último SELECT e `foreign_key_check` devem vir vazios. Auditorias permitem recuperar os rótulos e os pesos originais exatos. Não há ação de rollback destrutiva na interface: os triggers impedem voltar a persistir temas livres por acidente. Uma reversão operacional exige backup/restauração ou migração deliberada; não se deve sobrescrever pesos atuais com o snapshot inicial depois de novos feedbacks.

## Política dos pesos

Para cada categoria, a consolidação faz a média aritmética de todos os pesos existentes que mapeiam para ela, incluindo zeros. Aliases ausentes não contam como zero; negativos e frações são preservados. Pesos de rótulos desconhecidos são consolidados em Outros pela mesma regra e auditados como fallback.

Exemplo: `IA aplicada a código: 6`, `Hardware: 3`, `Technology: 0` viram `tecnologia: 3`, não 9. O JSON exato anterior e cada parcela ficam auditados. Um perfil sem pesos continua `{}`: não há preferência presumida para categorias ainda sem sinal.

A média acontece uma única vez sobre os aliases legados. Depois disso, um novo voto soma/subtrai 3 no total canônico; salvar e primeiro clique somam 1; desfazer aplica o delta oposto. Não se divide um novo feedback pelo número de aliases históricos. O valor acumulado não é truncado no banco; reabrir a aplicação não refaz a média nem perde o excesso acima do teto. Ajustes manuais definem um novo ponto de partida para sinais posteriores.

Testes: `tests/taxonomy.test.ts`, `tests/taxonomy-profile.test.ts`, `tests/feedback.test.ts`, `tests/ai.test.ts` e `tests/pipeline.test.ts`, com SQLite em memória, renderização isolada do perfil e endpoints HTTP de fixture locais, sem chamada paga.
