import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { interestProfile, processedItems, rawItems, sources, feedback } from "../src/db/schema";
import { applyFeedback, learnedWeights, updateTopicWeight, adjustedScore } from "../src/lib/feedback";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
function setup() {
  const db = openDatabase(":memory:"); databases.push(db);
  const source = db.insert(sources).values({ channelId: "channel", name: "Canal" }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run();
  db.insert(rawItems).values({ id: "youtube:item", sourceId: source.id, externalId: "item", platform: "youtube", title: "Aula", text: "Ciência", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", fetchedAt: 1 }).run();
  db.insert(processedItems).values({ rawId: "youtube:item", theme: "Ciência", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Perfil", summary: "Resumo", isSpam: false, model: "test", processedAt: 1 }).run();
  return db;
}

describe("feedback e aprendizado local", () => {
  it("votos são reversíveis, sem multiplicar sinais no mesmo item", () => {
    const db = setup();
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ Ciência: 3 });
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ Ciência: 0 });
    applyFeedback(db, "youtube:item", "down");
    expect(learnedWeights(db)).toEqual({ Ciência: -3 });
    expect(adjustedScore(80, -3)).toBe(74);
  });
  it("salvar, visto e cliques persistem; múltiplos cliques não inflam o tema", () => {
    const db = setup();
    applyFeedback(db, "youtube:item", "save"); applyFeedback(db, "youtube:item", "seen");
    applyFeedback(db, "youtube:item", "click"); applyFeedback(db, "youtube:item", "click");
    expect(learnedWeights(db)).toEqual({ Ciência: 2 });
    expect(db.select().from(feedback).get()).toMatchObject({ saved: true, seen: true, clicked: true });
    applyFeedback(db, "youtube:item", "save");
    expect(learnedWeights(db)).toEqual({ Ciência: 1 });
  });
  it("preserva o ajuste manual quando um novo sinal chega", () => {
    const db = setup();
    updateTopicWeight(db, "Ciência", 7);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ Ciência: 10 });
    expect(adjustedScore(95, 10)).toBe(100);
    expect(() => updateTopicWeight(db, "Ciência", 100)).toThrow();
  });
  it("mantém reversibilidade mesmo quando o peso exibido está no limite", () => {
    const db = setup();
    updateTopicWeight(db, "Ciência", 20);
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ Ciência: 20 });
    applyFeedback(db, "youtube:item", "up");
    expect(learnedWeights(db)).toEqual({ Ciência: 20 });
  });
  it("normaliza espaço no tema editado antes de aplicar ao ranking", () => {
    const db = setup();
    updateTopicWeight(db, " Ciência ", 7);
    expect(learnedWeights(db)).toEqual({ Ciência: 7 });
  });
  it("rejeita IDs inexistentes sem alterar o perfil", () => {
    const db = setup();
    expect(() => applyFeedback(db, "inventado", "up")).toThrow();
    expect(learnedWeights(db)).toEqual({});
    expect(db.select().from(interestProfile).where(eq(interestProfile.id, 1)).get()?.interests).toBe("Ciência");
  });
});
