import Sqlite from "better-sqlite3";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { consolidateTaxonomy, consolidateThemeCatalog } from "../src/db/taxonomy";
import { applyFeedback, learnedWeights, rankingExpression, updateTopicWeight } from "../src/lib/feedback";
import { legacyNormalizeTheme as normalizeTheme, legacyNormalizeThemeWeights as normalizeThemeWeights, LEGACY_TAXONOMY as TAXONOMY, THEME_IDS, themeLabel } from "../src/lib/taxonomy";

const clients: Sqlite.Database[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
function legacyDatabase() {
  const client = new Sqlite(":memory:"); clients.push(client);
  client.pragma("foreign_keys = ON");
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve("drizzle") });
  return db;
}
function legacyFixture() {
  const db = legacyDatabase();
  const source = db.insert(schema.sources).values({ channelId: "synthetic-taxonomy", name: "Fixture sintética" }).returning().get();
  const briefing = db.insert(schema.briefings).values({ snapshot: "synthetic-taxonomy", introduction: "Briefing sintético", createdAt: 1, windowFrom: 0, windowTo: 1, model: "fixture", sourceCount: 1 }).returning().get();
  db.insert(schema.topics).values({ id: "synthetic-cluster", briefingId: briefing.id, position: 0, title: "Um assunto específico", summary: "Cluster não é taxonomia", itemIds: '["youtube:legacy-0"]' }).run();
  const labels = ["IA aplicada a código", "Programação e auditoria", "Renan Santos e eleições", "Relações internacionais", "Rótulo sem contexto reconhecível"];
  labels.forEach((theme, index) => {
    const id = `youtube:legacy-${index}`;
    db.insert(schema.rawItems).values({ id, sourceId: source.id, platform: "youtube", externalId: `legacy-${index}`, title: "Fixture sintética", text: "", author: "Fixture", url: `https://www.youtube.com/watch?v=legacy-${index}`, fetchedAt: 1 }).run();
    db.insert(schema.sourceItems).values({ rawId: id, sourceId: source.id }).run();
    db.insert(schema.processedItems).values({ rawId: id, theme, tone: "informativo", language: "pt", type: "educação", score: 50, reason: "Fixture", summary: "Resumo sintético", isSpam: false, model: "fixture", processedAt: 1, clusterId: index === 0 ? "synthetic-cluster" : null }).run();
  });
  db.insert(schema.feedback).values({ rawId: "youtube:legacy-0", vote: 1, saved: true, seen: true, clicked: true, updatedAt: 10 }).run();
  db.insert(schema.collectorRuns).values({ status: "success", startedAt: 1, finishedAt: 2, itemCount: 5 }).run();
  db.insert(schema.aiCalls).values({ day: "2026-10-28", tokens: 150, cost: null, status: "settled", createdAt: 2 }).run();
  db.insert(schema.interestProfile).values({ id: 1, interests: "Meus interesses livres: IA, pesquisa e arte", excluded: "Exclusões livres originais", weights: '{ "IA aplicada a código": 6, "Hardware": 3, "Technology": 0, "Votos nulos": -4, "Sem significado conhecido": 2 }', updatedAt: 10 }).run();
  return db;
}

describe("catálogo controlado", () => {
  it("tem somente oito IDs e nomes únicos, com os dois recortes políticos", () => {
    expect(THEME_IDS).toEqual(["politica-interna", "politica-externa", "tecnologia", "ciencia-saude", "economia-trabalho", "sociedade-cotidiano", "cultura-lazer", "outros"]);
    expect(new Set(TAXONOMY.map(theme => theme.id)).size).toBe(8);
    expect(new Set(TAXONOMY.map(theme => theme.label)).size).toBe(8);
    expect(TAXONOMY.filter(theme => theme.id.startsWith("politica-"))).toHaveLength(2);
    for (const theme of TAXONOMY) {
      expect(normalizeTheme(theme.id)).toBe(theme.id);
      expect(normalizeTheme(theme.label)).toBe(theme.id);
      for (const alias of theme.aliases) expect(normalizeTheme(alias)).toBe(theme.id);
    }
  });
  it.each([
    ["  POLÍTICA BRASILEIRA  ", "politica-interna"], ["Brazilian politics", "politica-interna"], ["Renan Santos e eleições", "politica-interna"], ["Votos nulos", "politica-interna"],
    ["POLITICA EXTERNA", "politica-externa"], ["International relations", "politica-externa"], ["Geopolítica", "politica-externa"],
    ["Technology", "tecnologia"], ["IA aplicada a código", "tecnologia"], ["Programação e auditoria", "tecnologia"], ["Processadores", "tecnologia"], ["Mensageria descentralizada", "tecnologia"], ["Suporte técnico", "tecnologia"],
    ["CIÊNCIA", "ciencia-saude"], ["Science and health", "ciencia-saude"], ["Relato de trabalho", "economia-trabalho"], ["Trabalho noturno", "economia-trabalho"], ["Dívida dos EUA", "economia-trabalho"], ["Ações e Zona Franca de Manaus", "economia-trabalho"],
    ["Hardware e desempenho de PC", "tecnologia"], ["Relato profissional", "economia-trabalho"],
    ["Aluguel de carros", "sociedade-cotidiano"], ["Coleção de carros", "sociedade-cotidiano"], ["Oficina automotiva", "sociedade-cotidiano"], ["Animais de estimação", "sociedade-cotidiano"],
    ["Automóveis", "sociedade-cotidiano"], ["Animais", "sociedade-cotidiano"], ["Gaming", "cultura-lazer"], ["Mercado de jogos", "cultura-lazer"], ["Reação humorística", "cultura-lazer"],
    ["Renan Santos e política", "politica-interna"], ["Internacionalização e política", "politica-externa"],
  ])("normaliza %s como %s sem criar tema", (input, expected) => {
    expect(normalizeTheme(input)).toBe(expected);
    expect(themeLabel(input)).toBe(themeLabel(expected));
  });
  it("não infere o assunto de rótulos desconhecidos e calcula média, não soma", () => {
    expect(normalizeTheme("assunto inventado")).toBeUndefined();
    for (const theme of ["Mundo", "Política", "Crítica política", "Política e saúde", "Debate entre japoneses e franceses", "Lista de nomes", "Saudação", "Elogio a Kim"]) expect(normalizeTheme(theme)).toBeUndefined();
    expect(themeLabel("assunto inventado")).toBe("Outros");
    expect(normalizeThemeWeights({ Tecnologia: 8, Hardware: 2, Technology: -1, "tema desconhecido": 6 })).toEqual({ tecnologia: 3, outros: 6 });
    expect(normalizeThemeWeights({ Tecnologia: 1e308, Hardware: 1e308 })).toEqual({ tecnologia: 1e308 });
    expect(() => normalizeThemeWeights({ Tecnologia: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("consolidação transacional da taxonomia", () => {
  it("audita originais, mapeia desconhecidos e preserva itens, links, interesses, feedback e clusters", () => {
    const db = legacyFixture();
    const before = {
      raw: db.select().from(schema.rawItems).all(), links: db.select().from(schema.sourceItems).all(),
      processed: db.select().from(schema.processedItems).all(), feedback: db.select().from(schema.feedback).all(),
      profile: db.select().from(schema.interestProfile).get()!, topics: db.select().from(schema.topics).all(), briefings: db.select().from(schema.briefings).all(),
      runs: db.select().from(schema.collectorRuns).all(), calls: db.select().from(schema.aiCalls).all(),
    };
    expect(consolidateTaxonomy(db)).toEqual({ version: 1, applied: true, items: 5, profiles: 1, fallbackItems: 1, fallbackWeights: 1 });
    expect(db.select().from(schema.processedItems).all()).toEqual(before.processed.map((item, index) => ({ ...item, theme: ["tecnologia", "tecnologia", "politica-interna", "politica-externa", "outros"][index] })));
    expect(db.select().from(schema.rawItems).all()).toEqual(before.raw);
    expect(db.select().from(schema.sourceItems).all()).toEqual(before.links);
    expect(db.select().from(schema.feedback).all()).toEqual(before.feedback);
    expect(db.select().from(schema.topics).all()).toEqual(before.topics);
    expect(db.select().from(schema.briefings).all()).toEqual(before.briefings);
    expect(db.select().from(schema.collectorRuns).all()).toEqual(before.runs);
    expect(db.select().from(schema.aiCalls).all()).toEqual(before.calls);
    expect(db.select().from(schema.interestProfile).get()).toEqual({ ...before.profile, weights: '{"tecnologia":3,"politica-interna":-4,"outros":2}' });
    expect(db.$client.prepare("SELECT original_theme, theme_id, mapping FROM taxonomy_item_audit WHERE raw_id = ?").get("youtube:legacy-4")).toEqual({ original_theme: "Rótulo sem contexto reconhecível", theme_id: "outros", mapping: "fallback" });
    expect(db.$client.prepare("SELECT original_weights, mapped_weights FROM taxonomy_profile_audit WHERE profile_id = 1").get()).toEqual({ original_weights: before.profile.weights, mapped_weights: '{"tecnologia":3,"politica-interna":-4,"outros":2}' });
    expect(db.$client.prepare("SELECT original_theme, original_weight, theme_id, mapped_weight FROM taxonomy_weight_audit WHERE profile_id = 1 AND theme_id = 'tecnologia' ORDER BY original_theme").all()).toEqual([
      { original_theme: "Hardware", original_weight: 3, theme_id: "tecnologia", mapped_weight: 3 },
      { original_theme: "IA aplicada a código", original_weight: 6, theme_id: "tecnologia", mapped_weight: 3 },
      { original_theme: "Technology", original_weight: 0, theme_id: "tecnologia", mapped_weight: 3 },
    ]);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });
  it("é idempotente, sem repetir médias nem apagar feedback posterior", () => {
    const db = legacyFixture();
    const report = consolidateTaxonomy(db);
    applyFeedback(db, "youtube:legacy-1", "up");
    expect(learnedWeights(db).tecnologia).toBe(6);
    const before = db.$client.prepare("SELECT * FROM taxonomy_profile_audit").all();
    expect(consolidateTaxonomy(db)).toEqual({ ...report, applied: false });
    expect(learnedWeights(db).tecnologia).toBe(6);
    expect(db.$client.prepare("SELECT * FROM taxonomy_profile_audit").all()).toEqual(before);
    applyFeedback(db, "youtube:legacy-1", "up");
    expect(learnedWeights(db).tecnologia).toBe(3);
  });
  it("preserva médias fracionárias e reversibilidade de novos sinais, inclusive acima do teto", () => {
    const db = legacyFixture();
    db.update(schema.interestProfile).set({ weights: '{"IA":40,"Hardware":41}' }).run();
    consolidateTaxonomy(db);
    expect(JSON.parse(db.select().from(schema.interestProfile).get()!.weights)).toEqual({ tecnologia: 40.5 });
    expect(learnedWeights(db).tecnologia).toBe(20);
    applyFeedback(db, "youtube:legacy-1", "up"); applyFeedback(db, "youtube:legacy-1", "up");
    expect(JSON.parse(db.select().from(schema.interestProfile).get()!.weights).tecnologia).toBe(40.5);
    consolidateThemeCatalog(db);
    updateTopicWeight(db, "HARDWARE", 2.5);
    applyFeedback(db, "youtube:legacy-1", "save"); applyFeedback(db, "youtube:legacy-1", "save");
    expect(learnedWeights(db).tecnologia).toBe(2.5);
    const ranking = db.select({ score: rankingExpression({ tecnologia: 2.5 }) }).from(schema.processedItems).where(eq(schema.processedItems.rawId, "youtube:legacy-1")).get();
    expect(ranking?.score).toBe(55);
    expect(() => updateTopicWeight(db, "tema livre novo", 2)).toThrow(/tema|taxonomia/i);
  });
  it("reverte toda a transação se uma escrita falhar e permite tentar novamente", () => {
    const db = legacyFixture();
    const before = db.select().from(schema.processedItems).all();
    const profile = db.select().from(schema.interestProfile).get();
    db.$client.exec("CREATE TRIGGER synthetic_failure BEFORE UPDATE OF theme ON processed_items WHEN NEW.rawId = 'youtube:legacy-1' BEGIN SELECT RAISE(ABORT, 'falha sintética'); END");
    expect(() => consolidateTaxonomy(db)).toThrow(/falha sintética/);
    expect(db.select().from(schema.processedItems).all()).toEqual(before);
    expect(db.select().from(schema.interestProfile).get()).toEqual(profile);
    expect(db.$client.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'taxonomy_%'").all()).toEqual([]);
    db.$client.exec("DROP TRIGGER synthetic_failure");
    expect(consolidateTaxonomy(db).applied).toBe(true);
  });
  it.each(['{"IA":"inválido"}', '{"IA":1,"IA":3}', '{"IA":1e999}', '[]', 'não é JSON'])("recusa pesos legados corrompidos sem perder originais: %s", weights => {
    const db = legacyFixture();
    db.update(schema.interestProfile).set({ weights }).run();
    expect(() => consolidateTaxonomy(db)).toThrow();
    expect(db.select().from(schema.processedItems).get()?.theme).toBe("IA aplicada a código");
    expect(db.select().from(schema.interestProfile).get()?.weights).toBe(weights);
    expect(db.$client.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'taxonomy_%'").all()).toEqual([]);
  });
  it("a persistência recusa temas arbitrários, aliases, pesos inválidos e alterações do catálogo", () => {
    const db = legacyFixture(); consolidateTaxonomy(db);
    const item = db.select().from(schema.processedItems).get()!;
    db.delete(schema.processedItems).where(eq(schema.processedItems.rawId, item.rawId)).run();
    expect(() => db.insert(schema.processedItems).values({ ...item, theme: "inventado" }).run()).toThrow(/taxonomia/i);
    expect(() => db.insert(schema.processedItems).values({ ...item, theme: "Tecnologia" }).run()).toThrow(/taxonomia/i);
    db.insert(schema.processedItems).values({ ...item, theme: "tecnologia" }).run();
    expect(() => db.update(schema.processedItems).set({ theme: "novo" }).run()).toThrow(/taxonomia/i);
    for (const weights of ['{"Hardware":1}', '{"novo":2}', '[]', '{"tecnologia":1,"tecnologia":2}', '{"tecnologia":"1"}', '{"tecnologia":1e999}', 'não é JSON']) {
      expect(() => db.update(schema.interestProfile).set({ weights }).run()).toThrow();
      expect(() => db.insert(schema.interestProfile).values({ id: 2, interests: "Fixture", excluded: "", weights, updatedAt: 1 }).run()).toThrow();
    }
    expect(() => db.$client.prepare("INSERT INTO taxonomy_themes (id, label) VALUES (?, ?)").run("novo", "Novo")).toThrow();
    expect(() => db.$client.exec("UPDATE taxonomy_themes SET label = 'Outro nome' WHERE id = 'tecnologia'")).toThrow();
    expect(() => db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'tecnologia'")).toThrow();
  });
  it("audita também o ID original de classificações novas", () => {
    const db = legacyDatabase(); consolidateTaxonomy(db);
    const source = db.insert(schema.sources).values({ channelId: "synthetic-new", name: "Fixture" }).returning().get();
    db.insert(schema.rawItems).values({ id: "youtube:new", sourceId: source.id, platform: "youtube", externalId: "new", title: "Fixture", text: "", author: "Fixture", url: "https://www.youtube.com/watch?v=new", fetchedAt: 1 }).run();
    db.insert(schema.processedItems).values({ rawId: "youtube:new", theme: "cultura-lazer", tone: "humorístico", language: "pt", type: "meme", score: 50, reason: "Fixture", summary: "Resumo sintético", isSpam: false, model: "fixture", processedAt: 1 }).run();
    expect(db.$client.prepare("SELECT original_theme, theme_id, mapping FROM taxonomy_item_audit WHERE raw_id = 'youtube:new'").get()).toEqual({ original_theme: "cultura-lazer", theme_id: "cultura-lazer", mapping: "canonical" });
  });
});
