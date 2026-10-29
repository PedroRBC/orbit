import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { interestProfile, processedItems, rawItems, sources, feedback } from "../src/db/schema";
import { applyFeedback, learnedWeights, updateTopicWeight, adjustedScore, rankingExpression } from "../src/lib/feedback";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
function setup() {
  const db = openDatabase(":memory:"); databases.push(db);
  const source = db.insert(sources).values({ channelId: "channel", name: "Canal" }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run();
  db.insert(rawItems).values({ id: "youtube:item", sourceId: source.id, externalId: "item", platform: "youtube", title: "Aula", text: "Ciência", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", fetchedAt: 1 }).run();
  db.insert(processedItems).values({ rawId: "youtube:item", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Perfil", summary: "Resumo", isSpam: false, model: "test", processedAt: 1 }).run();
  return db;
}

describe("feedback e aprendizado local", () => {
  it("feedback em notícia registra voto, clique e salvar sem alterar pesos pessoais já existentes", () => {
    const db = setup(), source = db.select().from(sources).get()!;
    db.update(interestProfile).set({ weights: '{"ciencia-saude":7}' }).run();
    db.insert(rawItems).values({ id: "news:item", sourceId: source.id, externalId: "news", platform: "news", evidence: "news_rss", title: "Notícia sintética", text: "Trecho", author: "Portal", url: "https://fixture.example/news", fetchedAt: Date.now(), newsPublishedAt: Date.now() }).run();
    db.insert(processedItems).values({ rawId: "news:item", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "notícia", score: 80, reason: "Geral", summary: "Resumo", isSpam: false, model: "test", processedAt: 1 }).run();
    for (const action of ["up", "click", "click", "save", "down"] as const) applyFeedback(db, "news:item", action);
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 7 });
    expect(db.select().from(feedback).where(eq(feedback.rawId, "news:item")).get()).toMatchObject({ vote: -1, clicked: true, saved: true });
    applyFeedback(db, "youtube:item", "up"); applyFeedback(db, "youtube:item", "click");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 11 });
  });
  it("votos são reversíveis, sem multiplicar sinais no mesmo item", () => {
    const db = setup();
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 3 });
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 0 });
    applyFeedback(db, "youtube:item", "down");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": -3 });
    expect(adjustedScore(80, -3)).toBe(74);
  });
  it("salvar, visto e cliques persistem; múltiplos cliques não inflam o tema", () => {
    const db = setup();
    applyFeedback(db, "youtube:item", "save"); applyFeedback(db, "youtube:item", "seen");
    applyFeedback(db, "youtube:item", "click"); applyFeedback(db, "youtube:item", "click");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 2 });
    expect(db.select().from(feedback).get()).toMatchObject({ saved: true, seen: true, clicked: true });
    applyFeedback(db, "youtube:item", "save");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 1 });
  });
  it("preserva o ajuste manual quando um novo sinal chega", () => {
    const db = setup();
    updateTopicWeight(db, "Ciência", 7);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 10 });
    expect(adjustedScore(95, 10)).toBe(100);
    expect(() => updateTopicWeight(db, "Ciência", 100)).toThrow();
  });
  it("mantém reversibilidade mesmo quando o peso exibido está no limite", () => {
    const db = setup();
    updateTopicWeight(db, "Ciência", 20);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 20 });
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 20 });
  });
  it("normaliza espaço no tema editado antes de aplicar ao ranking", () => {
    const db = setup();
    updateTopicWeight(db, " Ciência ", 7);
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 7 });
  });
  it("aceita aliases pt/en e acentos, mas não cria pesos de tema livre", () => {
    const db = setup();
    updateTopicWeight(db, " CIÊNCIA ", 2.5);
    updateTopicWeight(db, "Science and health", 4.5);
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 4.5 });
    expect(() => updateTopicWeight(db, "assunto inventado", 2)).toThrow(/catálogo|taxonomia/);
    applyFeedback(db, "youtube:item", "up"); applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ "ciencia-saude": 4.5 });
  });
  it("voto em tema criado altera esse tema", () => {
    const db = setup();
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("automotivo", "Automotivo");
    db.update(processedItems).set({ theme: "automotivo" }).run();
    applyFeedback(db, "youtube:item", "up");
    expect(JSON.parse(db.select().from(interestProfile).get()!.weights)).toEqual({ automotivo: 3 });
    expect(learnedWeights(db)).toEqual({ automotivo: 3 });
  });
  it("updateTopicWeight aceita id criado", () => {
    const db = setup();
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("automotivo", "Automotivo");
    updateTopicWeight(db, "automotivo", 2.5);
    expect(learnedWeights(db)).toEqual({ automotivo: 2.5 });
    expect(() => updateTopicWeight(db, "inexistente", 2)).toThrow(/catálogo|taxonomia/);
  });
  it("ranking usa ids do catálogo sem normalizar pesos em tempo de leitura", () => {
    const db = setup();
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("automotivo", "Automotivo");
    db.update(processedItems).set({ theme: "automotivo" }).run();
    expect(db.select({ score: rankingExpression({ automotivo: 4.5 }) }).from(processedItems).get()?.score).toBe(89);
    const inherited: Record<string, number> = Object.create({ automotivo: 20 });
    expect(db.select({ score: rankingExpression(inherited) }).from(processedItems).get()?.score).toBe(80);
    db.update(processedItems).set({ theme: "ciencia-saude" }).run();
    expect(db.select({ score: rankingExpression({ Ciência: 5 }) }).from(processedItems).get()?.score).toBe(80);
  });
  it("feedback, ajuste e ranking tratam apenas chaves próprias como pesos", () => {
    const db = setup();
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("constructor", "Constructor");
    db.update(processedItems).set({ theme: "constructor" }).run();
    expect(db.select({ score: rankingExpression({}) }).from(processedItems).get()?.score).toBe(80);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ constructor: 3 });
    expect(db.select({ score: rankingExpression(learnedWeights(db)) }).from(processedItems).get()?.score).toBe(86);
    updateTopicWeight(db, "constructor", -2.5);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ constructor: -5.5 });
  });
  it("rejeita IDs inexistentes sem alterar o perfil", () => {
    const db = setup();
    expect(() => applyFeedback(db, "inventado", "up")).toThrow();
    expect(learnedWeights(db)).toEqual({});
    expect(db.select().from(interestProfile).where(eq(interestProfile.id, 1)).get()?.interests).toBe("Ciência");
  });
});
