import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type OrbitDB } from "../src/db/index";
import { interestProfile, processedItems, rawItems, sources } from "../src/db/schema";
import { listThemes } from "../src/lib/taxonomy";
import { applyThemeProposal, mergeTheme, pendingProposalGroups, promoteProposals } from "../src/lib/themes";

const databases: OrbitDB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
function database() {
  const db = openDatabase(":memory:"); databases.push(db);
  db.insert(sources).values({ channelId: "synthetic-proposals", name: "Fixture sintética" }).run();
  db.$client.exec("BEGIN IMMEDIATE");
  return db;
}
function item(db: OrbitDB, id: string, theme = "sociedade-cotidiano", platform = "youtube", isSpam = false) {
  db.insert(rawItems).values({ id, sourceId: 1, platform, externalId: id, title: "Fixture sintética", text: "", author: "Fixture", url: `https://example.com/${id}`, fetchedAt: 1 }).run();
  db.insert(processedItems).values({ rawId: id, theme, tone: "informativo", language: "pt", type: "educação", score: 50, reason: "Fixture", summary: "Sintético", isSpam, model: "fixture", processedAt: 1 }).run();
  return id;
}
function automotive(db: OrbitDB) {
  for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `car-${i}`), i === 0 ? { label: "Automotivo", aliases: ["Carros"] } : i === 1 ? { label: "Automotivo" } : { label: "Carros", aliases: ["Automotivo"] });
  return promoteProposals(db, 100);
}
function themeOf(db: OrbitDB, id: string) { return db.$client.prepare("SELECT theme FROM processed_items WHERE rawId = ?").pluck().get(id); }
function proposals(db: OrbitDB) { return db.$client.prepare("SELECT * FROM theme_proposals").all(); }
function legacy(db: OrbitDB, id: string, label: string) { db.$client.prepare("UPDATE taxonomy_item_audit SET original_theme = ? WHERE raw_id = ?").run(label, id); }

// As escritas destes helpers pertencem à transação IMMEDIATE do chamador (owned no worker).
describe("propostas e recorrência de temas", () => {
  it("três itens pessoais criam o tema e migram", () => {
    const db = database();
    db.transaction(() => { expect(automotive(db)).toEqual(["automotivo"]); }, { behavior: "immediate" });
    expect(listThemes(db).at(-1)).toMatchObject({ id: "automotivo", label: "Automotivo", origin: "ai", aliases: ["Carros"], createdAt: 100 });
    expect(db.select().from(processedItems).all().map(row => row.theme)).toEqual(["automotivo", "automotivo", "automotivo"]);
    expect(db.$client.prepare("SELECT from_theme, to_theme, reason, at FROM taxonomy_reassignments").all()).toEqual(Array(3).fill({ from_theme: "sociedade-cotidiano", to_theme: "automotivo", reason: "proposal", at: 100 }));
    expect(proposals(db)).toEqual([]);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("dois itens ficam em observação e repetir o mesmo item não aumenta a contagem", () => {
    const db = database(); const first = item(db, "first");
    for (let i = 0; i < 3; i++) applyThemeProposal(db, first, { label: "Automotivo", aliases: ["Carros"] });
    applyThemeProposal(db, item(db, "second"), { label: "Carros" });
    expect(promoteProposals(db)).toEqual([]);
    expect(pendingProposalGroups(db)).toEqual([{ label: "Automotivo", count: 2 }]);
  });

  it("proposta resolve por rótulo existente e por alias de tema ai", () => {
    const db = database(); automotive(db); const id = item(db, "later");
    for (const proposal of [{ label: "carro" }, { label: "Carros elétricos", aliases: ["Carros"] }]) expect(applyThemeProposal(db, id, proposal)).toBe("automotivo");
    expect(applyThemeProposal(db, id, { label: "Educação" })).toBe("sociedade-cotidiano");
    expect(proposals(db)).toEqual([]);
  });

  it("aliases de temas ai só resolvem com um único destino", () => {
    const db = database(); automotive(db);
    db.$client.exec("INSERT INTO taxonomy_themes (id, label, origin, aliases) VALUES ('aviacao', 'Aviação', 'ai', '[\"Aviões\"]')");
    expect(applyThemeProposal(db, item(db, "ambiguous"), { label: "Motores", aliases: ["Carros", "Aviões"] })).toBeNull();
    expect(pendingProposalGroups(db)).toEqual([{ label: "Motores", count: 1 }]);
    expect(proposals(db)).toEqual([expect.objectContaining({ aliases: "[]" })]);
  });

  it("alias de semente não captura nem migra", () => {
    const db = database(); const old = item(db, "legacy-mobility"); legacy(db, old, "Mobilidade");
    for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `new-${i}`), { label: "Automotivo", aliases: ["Mobilidade"] });
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(listThemes(db).at(-1)?.aliases).not.toContain("Mobilidade");
    expect(themeOf(db, old)).toBe("sociedade-cotidiano");
  });

  it("alias descartado não conecta grupos em observação", () => {
    const db = database();
    for (const [id, label] of [["car", "Automotivo"], ["plane", "Aviação"], ["boat", "Náutica"]]) applyThemeProposal(db, item(db, id), { label, aliases: ["MOBILIDADES"] });
    expect(promoteProposals(db)).toEqual([]);
    expect(pendingProposalGroups(db)).toHaveLength(3);
    expect(proposals(db).every(row => (row as { aliases: string }).aliases === "[]")).toBe(true);
  });

  it("rótulos legados migram por igualdade exata e só enquanto conservam o tema v1", () => {
    const db = database();
    for (const [id, label] of [["legacy", "CARRO!"], ["changed", "Carros"], ["substring", "Aluguel de carros"], ["news", "Carros"]]) { item(db, id, "sociedade-cotidiano", id === "news" ? "news" : "youtube"); legacy(db, id, label); }
    db.$client.exec("UPDATE processed_items SET theme = 'tecnologia' WHERE rawId = 'changed'");
    automotive(db);
    expect(["legacy", "changed", "substring", "news"].map(id => themeOf(db, id))).toEqual(["automotivo", "tecnologia", "sociedade-cotidiano", "automotivo"]);
    expect(db.$client.prepare("SELECT raw_id, reason FROM taxonomy_reassignments WHERE reason = 'legacy_label' ORDER BY raw_id").all()).toEqual([{ raw_id: "legacy", reason: "legacy_label" }, { raw_id: "news", reason: "legacy_label" }]);
  });

  it("notícias e spam não propõem", () => {
    const db = database();
    for (const id of [item(db, "news", "outros", "news"), item(db, "spam", "outros", "youtube", true), "missing"]) expect(applyThemeProposal(db, id, { label: "Automotivo" })).toBeNull();
    expect(proposals(db)).toEqual([]);
  });

  it("rótulos inválidos são ignorados", () => {
    const db = database(); const id = item(db, "invalid");
    for (const label of ["Eleições 2026", "日本料理", "Um tema com cinco palavras", "", "A".repeat(41)]) expect(applyThemeProposal(db, id, { label })).toBeNull();
    expect(proposals(db)).toEqual([]);
  });

  it("agrupa componentes transitivos e escolhe o rótulo mais antigo no empate", () => {
    const db = database();
    for (const [id, label, aliases] of [["oldest", "Automotivo", ["Motores"]], ["middle", "Transporte", ["Veículos"]], ["newest", "Carros", ["Motores", "Veículos"]]] as const) applyThemeProposal(db, item(db, id), { label, aliases: [...aliases] });
    db.$client.exec("UPDATE theme_proposals SET created_at = CASE raw_id WHEN 'oldest' THEN 1 WHEN 'middle' THEN 2 ELSE 3 END");
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(listThemes(db).at(-1)?.aliases).toEqual(expect.arrayContaining(["Motores", "Carros", "Veículos", "Transporte"]));
  });

  it("escolhe a maioria normalizada, não simplesmente o primeiro rótulo", () => {
    const db = database();
    applyThemeProposal(db, item(db, "minority"), { label: "Carros", aliases: ["Automotivo"] });
    applyThemeProposal(db, item(db, "majority-first"), { label: "Automotivo" });
    applyThemeProposal(db, item(db, "majority-second"), { label: "AUTOMOTIVO" });
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(listThemes(db).at(-1)?.label).toBe("Automotivo");
  });

  it("normaliza pontuação de aliases sem impor a eles a validação do rótulo", () => {
    const db = database();
    applyThemeProposal(db, item(db, "alias-punctuation"), { label: "Automotivo", aliases: ["CARROS!", "  "] });
    applyThemeProposal(db, item(db, "alias-label"), { label: "Carro" });
    applyThemeProposal(db, item(db, "alias-third"), { label: "Automotivo" });
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(listThemes(db).at(-1)?.aliases).toEqual(["CARROS!"]);
  });

  it("não agrupa por inclusão de palavras", () => {
    const db = database();
    for (const [id, label] of [["car", "Carros"], ["rental", "Aluguel de carros"], ["collection", "Coleção de carros"]]) applyThemeProposal(db, item(db, id), { label });
    expect(promoteProposals(db)).toEqual([]);
    expect(pendingProposalGroups(db)).toHaveLength(3);
  });

  it("teto de 40 mantém as propostas e permite promover depois de juntar", () => {
    const db = database();
    const insert = db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')");
    for (let i = 0; i < 32; i++) insert.run(`fixture-${i}`, `Fixture ${i}`);
    expect(automotive(db)).toEqual([]);
    expect(listThemes(db)).toHaveLength(40);
    expect(pendingProposalGroups(db)).toEqual([{ label: "Automotivo", count: 3 }]);
    mergeTheme(db, "fixture-0", "outros");
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(listThemes(db)).toHaveLength(40);
  });

  it("limita observação aos vinte grupos mais recentes", () => {
    const db = database();
    for (let i = 0; i < 23; i++) { const id = item(db, `pending-${i}`); applyThemeProposal(db, id, { label: `Área ${String.fromCharCode(65 + i)}` }); db.$client.prepare("UPDATE theme_proposals SET created_at = ? WHERE raw_id = ?").run(i, id); }
    const groups = pendingProposalGroups(db);
    expect(groups).toHaveLength(20);
    expect(groups[0]).toEqual({ label: "Área W", count: 1 });
    expect(groups.at(-1)).toEqual({ label: "Área D", count: 1 });
    expect(pendingProposalGroups(db, 2)).toEqual(groups.slice(0, 2));
    expect(pendingProposalGroups(db, 100)).toHaveLength(20);
  });

  it.each(["id", "alias"])("gera sufixo de slug por colisão de %s sem ultrapassar quarenta caracteres", collision => {
    const db = database();
    const prefix = "a".repeat(38);
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin, aliases) VALUES (?, 'Fixture', 'ai', ?)").run(collision === "id" ? prefix : "fixture-target", JSON.stringify(collision === "alias" ? [prefix] : []));
    for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `slug-${i}`), { label: `${prefix} 日` });
    expect(promoteProposals(db)).toEqual([`${prefix}-2`]);
  });

  it.each([{ label: "Automotivo" }, { label: "Transporte", aliases: ["Automotivo"] }])("revalida rótulo e aliases após cada promoção: %j", proposal => {
    const db = database();
    for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `mixed-${i}`), { label: "Automotivo 日" });
    for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `plain-${i}`), proposal);
    expect(promoteProposals(db)).toEqual(["automotivo"]);
    expect(db.select().from(processedItems).all().every(row => row.theme === "automotivo")).toBe(true);
    expect(proposals(db)).toEqual([]);
  });

  it("juntar temas move itens, preserva aliases e auditoria e apaga a origem", () => {
    const db = database(); automotive(db);
    item(db, "direct-ai", "automotivo");
    expect(db.transaction(() => mergeTheme(db, "automotivo", "sociedade-cotidiano"), { behavior: "immediate" })).toBe(4);
    expect(listThemes(db).some(theme => theme.id === "automotivo")).toBe(false);
    expect(db.select().from(processedItems).all().every(row => row.theme === "sociedade-cotidiano")).toBe(true);
    expect(listThemes(db).find(theme => theme.id === "sociedade-cotidiano")?.aliases).toEqual(expect.arrayContaining(["Automotivo", "Carros", "Mobilidade"]));
    expect(db.$client.prepare("SELECT count(*) FROM taxonomy_reassignments WHERE reason = 'merge'").pluck().get()).toBe(4);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([
    [{ automotivo: 6, "sociedade-cotidiano": 2, tecnologia: 7 }, { "sociedade-cotidiano": 4, tecnologia: 7 }],
    [{ automotivo: 6 }, { "sociedade-cotidiano": 6 }],
    [{ "sociedade-cotidiano": 0 }, { "sociedade-cotidiano": 0 }],
    [{ automotivo: 1.7e308, "sociedade-cotidiano": 1.7e308 }, { "sociedade-cotidiano": 1.7e308 }],
  ])("juntar combina pesos sem normalização legada: %j", (weights, expected) => {
    const db = database(); automotive(db);
    db.insert(interestProfile).values({ id: 1, interests: "Fixture", excluded: "", weights: JSON.stringify(weights), updatedAt: 1 }).run();
    mergeTheme(db, "automotivo", "sociedade-cotidiano");
    expect(JSON.parse(db.select().from(interestProfile).get()!.weights)).toEqual(expected);
  });

  it("juntar copia o peso para constructor sem ler propriedades herdadas", () => {
    const db = database(); automotive(db);
    for (let i = 0; i < 3; i++) applyThemeProposal(db, item(db, `constructor-${i}`), { label: "Constructor" });
    expect(promoteProposals(db)).toEqual(["constructor"]);
    db.insert(interestProfile).values({ id: 1, interests: "Fixture", excluded: "", weights: JSON.stringify({ automotivo: 6 }), updatedAt: 1 }).run();
    expect(db.transaction(() => mergeTheme(db, "automotivo", "constructor"), { behavior: "immediate" })).toBe(3);
    expect(JSON.parse(db.select().from(interestProfile).get()!.weights)).toEqual({ constructor: 6 });
    expect(listThemes(db).some(theme => theme.id === "automotivo")).toBe(false);
    expect(db.select().from(processedItems).all().every(row => row.theme === "constructor")).toBe(true);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("juntar rejeita origem semente, destino ausente e origem igual ao destino", () => {
    const db = database(); automotive(db);
    expect(() => mergeTheme(db, "tecnologia", "outros")).toThrow("Somente temas criados automaticamente podem ser juntados.");
    expect(() => mergeTheme(db, "automotivo", "missing")).toThrow();
    expect(() => mergeTheme(db, "automotivo", "automotivo")).toThrow();
    expect(themeOf(db, "car-0")).toBe("automotivo");
  });
});
