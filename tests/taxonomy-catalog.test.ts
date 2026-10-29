import Sqlite from "better-sqlite3";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/index";
import * as schema from "../src/db/schema";
import { assertThemeAliasesUnique, consolidateTaxonomy, consolidateThemeCatalog } from "../src/db/taxonomy";
import { LEGACY_TAXONOMY, listThemes, resolveTheme, SEED_IDS, themeKey, themeLabels, themeSlug, validThemeLabel } from "../src/lib/taxonomy";

const clients: Sqlite.Database[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
function catalogDatabase() {
  const db = openDatabase(":memory:"); clients.push(db.$client);
  return db;
}

describe("catálogo de temas v2", () => {
  it("v2 aplica uma vez e preserva alterações posteriores", () => {
    const db = catalogDatabase();
    expect(db.$client.prepare("SELECT version FROM taxonomy_catalog_consolidations").all()).toEqual([{ version: 2 }]);
    expect(() => db.$client.exec("INSERT INTO taxonomy_catalog_consolidations (version, completed_at) VALUES (1, 1)")).toThrow();
    db.$client.exec("UPDATE taxonomy_themes SET aliases = '[\"Alias posterior\"]' WHERE id = 'tecnologia'");
    expect(consolidateThemeCatalog(db)).toEqual({ version: 2, applied: false });
    expect(resolveTheme(db, "Alias posterior")).toBe("tecnologia");
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("sementes mantêm IDs, novos escopos e aliases sem absorver automóveis", () => {
    const db = catalogDatabase();
    const themes = listThemes(db);
    expect(themes.map(theme => theme.id)).toEqual(["politica-interna", "politica-externa", "tecnologia", "ciencia-saude", "economia-trabalho", "sociedade-cotidiano", "cultura-lazer", "outros"]);
    expect(SEED_IDS).toEqual(themes.map(theme => theme.id));
    expect(themes.every(theme => theme.origin === "seed" && theme.createdAt === 0)).toBe(true);
    expect(themes.find(theme => theme.id === "politica-interna")?.label).toBe("Política do Brasil");
    expect(themes.find(theme => theme.id === "tecnologia")?.description).toMatch(/inovações.*Brasil.*mundo/);
    expect(themes.find(theme => theme.id === "sociedade-cotidiano")?.description).not.toContain("automóveis");
    expect(themeLabels(db).get("politica-interna")).toBe("Política do Brasil");
    for (const alias of ["politica-interna", "Política do Brasil", "Política interna", "  POLÍTICA INTERNA!! "]) expect(resolveTheme(db, alias)).toBe("politica-interna");
    for (const alias of ["Automóveis", "Aluguel de carros", "Coleção de carros", "Oficina automotiva", "Carros", "Cars", "Política do Brasil hoje"]) expect(resolveTheme(db, alias)).toBeUndefined();
    expect(resolveTheme(db, "Animais")).toBe("sociedade-cotidiano");
    expect(resolveTheme(db, "Animal")).toBe("sociedade-cotidiano");
    expect(LEGACY_TAXONOMY.find(theme => theme.id === "sociedade-cotidiano")?.aliases).toContain("Automóveis");
    expect(LEGACY_TAXONOMY[0].label).toBe("Política interna");
  });

  it("lê temas ai por criação, sem descrição, e resolve aliases do banco por igualdade exata", () => {
    const db = catalogDatabase();
    const insert = db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin, aliases, created_at) VALUES (?, ?, 'ai', ?, ?)");
    insert.run("automotivo", "Automotivo", '["Carros", "Automóveis"]', 20);
    insert.run("culinaria", "Culinária", '[]', 10);
    expect(listThemes(db).slice(8)).toEqual([
      { id: "culinaria", label: "Culinária", description: "", origin: "ai", aliases: [], createdAt: 10 },
      { id: "automotivo", label: "Automotivo", description: "", origin: "ai", aliases: ["Carros", "Automóveis"], createdAt: 20 },
    ]);
    for (const alias of ["automotivo", "AUTOMOTIVO", "carro", "Automóvel"]) expect(resolveTheme(db, alias)).toBe("automotivo");
    expect(resolveTheme(db, "Aluguel de carros")).toBeUndefined();
    expect(themeLabels(db).get("automotivo")).toBe("Automotivo");
  });

  it("guarda do catálogo permite só inserção ai com slug e rótulo limitados", () => {
    const db = catalogDatabase();
    expect(() => db.$client.exec("INSERT INTO taxonomy_themes (id, label) VALUES ('automotivo', 'Automotivo')")).toThrow();
    const insert = db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, ?)");
    for (const id of ["", "Carros", "carros!", "car_ros", "-carros", "carros-", "automóveis", "a\0invalid", "a".repeat(41)]) expect(() => insert.run(id, "Automotivo", "ai")).toThrow();
    for (const label of ["", "A", "a".repeat(41)]) expect(() => insert.run("automotivo", label, "ai")).toThrow();
    expect(() => insert.run("automotivo", "Automotivo", "other")).toThrow();
    insert.run("automotivo", "Automotivo", "ai");
    insert.run(`a${"-".repeat(38)}9`, "a".repeat(40), "ai");
    expect(resolveTheme(db, "automotivo")).toBe("automotivo");
    expect(() => db.$client.exec("UPDATE taxonomy_themes SET label = 'Outro nome' WHERE id = 'tecnologia'")).toThrow();
    for (const change of ["id = 'carros'", "label = 'Carros'", "origin = 'seed'"]) expect(() => db.$client.exec(`UPDATE taxonomy_themes SET ${change} WHERE id = 'automotivo'`)).toThrow();
    db.$client.exec("UPDATE taxonomy_themes SET aliases = '[\"Carros\"]' WHERE id = 'automotivo'");
    expect(resolveTheme(db, "carro")).toBe("automotivo");
    expect(() => db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'tecnologia'")).toThrow();
    db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'automotivo'");
    expect(resolveTheme(db, "carro")).toBeUndefined();
  });

  it("não apaga tema ai com item e mantém as guardas de itens e pesos da v1", () => {
    const db = catalogDatabase();
    db.$client.exec("INSERT INTO taxonomy_themes (id, label, origin) VALUES ('automotivo', 'Automotivo', 'ai')");
    const source = db.insert(schema.sources).values({ channelId: "synthetic-catalog", name: "Fixture sintética" }).returning().get();
    db.insert(schema.rawItems).values({ id: "youtube:synthetic-catalog", sourceId: source.id, platform: "youtube", externalId: "synthetic-catalog", title: "Fixture sintética", text: "", author: "Fixture", url: "https://example.com/synthetic-catalog", fetchedAt: 1 }).run();
    const item = { rawId: "youtube:synthetic-catalog", theme: "automotivo", tone: "informativo", language: "pt", type: "educação", score: 50, reason: "Fixture", summary: "Sintético", isSpam: false, model: "fixture", processedAt: 1 };
    expect(() => db.insert(schema.processedItems).values({ ...item, theme: "desconhecido" }).run()).toThrow(/taxonomia/i);
    db.insert(schema.processedItems).values(item).run();
    expect(() => db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'automotivo'")).toThrow();
    expect(() => db.$client.exec("UPDATE processed_items SET theme = 'desconhecido'")).toThrow(/taxonomia/i);
    db.insert(schema.interestProfile).values({ id: 1, interests: "Fixture", excluded: "", weights: '{"automotivo":2}', updatedAt: 1 }).run();
    expect(() => db.$client.exec("UPDATE interest_profile SET weights = '{\"desconhecido\":2}'")).toThrow(/taxonomia/i);
    db.$client.prepare("INSERT INTO theme_proposals (raw_id, label, label_key, created_at) VALUES (?, 'Automotivo', 'automotivo', 1)").run(item.rawId);
    expect(db.$client.prepare("SELECT aliases FROM theme_proposals WHERE raw_id = ?").get(item.rawId)).toEqual({ aliases: "[]" });
    expect(() => db.$client.exec("INSERT INTO theme_proposals (raw_id, label, label_key, created_at) VALUES ('missing', 'Novo', 'novo', 1)")).toThrow();
    const audit = db.$client.prepare("INSERT INTO taxonomy_reassignments (raw_id, from_theme, to_theme, reason, at) VALUES (?, 'outros', 'automotivo', ?, 1)");
    for (const reason of ["proposal", "legacy_label", "merge"]) audit.run(item.rawId, reason);
    expect(() => audit.run(item.rawId, "invalid")).toThrow();
    expect(() => audit.run("missing", "proposal")).toThrow();
    expect(db.$client.prepare("SELECT count(*) AS count FROM taxonomy_reassignments").get()).toEqual({ count: 3 });
    db.$client.exec("UPDATE interest_profile SET weights = '{}'; UPDATE processed_items SET theme = 'outros'");
    db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'automotivo'");
    expect(resolveTheme(db, "automotivo")).toBeUndefined();
    expect(db.$client.prepare("SELECT count(*) AS count FROM taxonomy_reassignments").get()).toEqual({ count: 3 });
    db.delete(schema.processedItems).run();
    db.insert(schema.processedItems).values({ ...item, theme: "outros" }).run();
    expect(db.$client.prepare("SELECT theme_id FROM taxonomy_item_audit WHERE raw_id = ?").get(item.rawId)).toEqual({ theme_id: "outros" });
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("rollback restaura esquema, rótulos e triggers v1 se o marcador falhar", () => {
    const client = new Sqlite(":memory:"); clients.push(client);
    client.pragma("foreign_keys = ON");
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: resolve("drizzle") });
    consolidateTaxonomy(db);
    client.exec(`CREATE TABLE taxonomy_catalog_consolidations (version INTEGER PRIMARY KEY CHECK (version = 2), completed_at INTEGER NOT NULL);
      CREATE TRIGGER synthetic_catalog_failure BEFORE INSERT ON taxonomy_catalog_consolidations BEGIN SELECT RAISE(ABORT, 'falha sintética v2'); END;`);
    const before = client.prepare("SELECT name, sql FROM sqlite_schema ORDER BY name").all();
    expect(() => consolidateThemeCatalog(db)).toThrow(/falha sintética v2/);
    expect(client.prepare("SELECT name, sql FROM sqlite_schema ORDER BY name").all()).toEqual(before);
    expect(client.prepare("SELECT label FROM taxonomy_themes WHERE id = 'politica-interna'").get()).toEqual({ label: "Política interna" });
    expect(() => client.exec("UPDATE taxonomy_themes SET label = 'Outro nome' WHERE id = 'tecnologia'")).toThrow(/fixo/);
    expect(() => client.exec("INSERT INTO taxonomy_themes (id, label) VALUES ('novo', 'Novo')")).toThrow(/fixo/);
    expect(() => client.exec("DELETE FROM taxonomy_themes WHERE id = 'tecnologia'")).toThrow(/fixo/);
    client.exec("DROP TRIGGER synthetic_catalog_failure");
    expect(consolidateThemeCatalog(db)).toEqual({ version: 2, applied: true });
    expect(listThemes(db)).toHaveLength(8);
  });

  it("aliases das sementes não colidem entre temas, incluindo IDs e rótulos", () => {
    const first = { id: "automotivo", label: "Automotivo", aliases: ["Carros", "carro"] };
    expect(() => assertThemeAliasesUnique([first])).not.toThrow();
    for (const second of [
      { id: "outro", label: "Outro", aliases: ["CARRO!"] },
      { id: "carro", label: "Outro", aliases: [] },
      { id: "outro", label: "Carros", aliases: [] },
    ]) expect(() => assertThemeAliasesUnique([first, second])).toThrow(/Alias duplicado entre temas/);
  });
});

it.each([
  ["Carros", "carro"], ["Automóveis", "automovel"], ["Animais", "animal"], ["Ações", "acao"], ["Pães", "pao"], ["Trens", "trem"],
  ["  COLEÇÃO--DE CARROS!! ", "colecao de carro"], ["CIÊNCIAS", "ciencia"], ["Pés", "pes"], ["", ""],
])("themeKey trata plural simples e pontuação: %s", (input, expected) => { expect(themeKey(input)).toBe(expected); });

it("themeSlug só usa ASCII, remove hífens nas pontas e limita 40 caracteres", () => {
  expect(themeSlug("  Ciência & Inovações!! ")).toBe("ciencia-inovacoes");
  expect(themeSlug("東京 🚗")).toBe("");
  expect(themeSlug(`${"a".repeat(39)} carro`)).toBe("a".repeat(39));
  expect(themeSlug("a".repeat(41))).toBe("a".repeat(40));
});

it("validThemeLabel exige 1–4 palavras de letras, espaços ou hífens e 2–40 caracteres", () => {
  for (const label of ["IA", "Mundo automotivo", "Ciência e saúde", "Cultura afro-brasileira", "a".repeat(40)]) expect(validThemeLabel(label)).toBe(true);
  for (const label of ["", "A", "a".repeat(41), "Tema 2026", "A B C D E", "Carros/aviões", "---", "Tema\nnovo"]) expect(validThemeLabel(label)).toBe(false);
});
