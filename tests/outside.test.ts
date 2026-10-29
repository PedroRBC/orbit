import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/index";
import { sources, processedItems, briefings, topics, rawItems } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { saveRawItems } from "../src/lib/store";
import { outsideItems } from "../src/lib/outside";

const databases: ReturnType<typeof openDatabase>[] = [];
function fixture() {
  const db = openDatabase(":memory:"); databases.push(db);
  const news = db.insert(sources).values({ channelId: "https://fixture.example/rss", name: "Portal sintético", kind: "news_rss", platform: "news" }).returning().get();
  const add = (id: string, newsPublishedAt: number | null = Date.now(), publishedAt: number | null = Date.now()) => saveRawItems(db, news.id, [{ platform: "news", evidence: "news_rss", externalId: id, title: id, text: "Trecho sintético", author: "Portal", url: `https://fixture.example/${id}`, thumbnail: null, publishedAt, newsPublishedAt, durationSeconds: null }]);
  return { db, add };
}
it("publishedAt recente com newsPublishedAt antigo, ausente ou futuro fica fora", () => {
  const { db, add } = fixture(), now = Date.now();
  add("old", now - 48 * 3600000 - 1000); add("undated", null); add("future", now + 60000); add("recent", now - 1000, 1);
  expect(outsideItems(db).map(row => row.item.id)).toEqual(["news:recent"]);
});
it("publicação comprovada recente não é descartada por fetchedAt legado antigo", () => {
  const { db, add } = fixture(); add("revalidated");
  db.update(rawItems).set({ fetchedAt: 1 }).where(eq(rawItems.id, "news:revalidated")).run();
  expect(outsideItems(db).map(row => row.item.id)).toEqual(["news:revalidated"]);
});
it("item citado no último briefing fica fora no SQL antes do limite", () => {
  const { db, add } = fixture(), now = Date.now();
  add("available", now - 2000, now - 2000);
  const old = db.insert(briefings).values({ snapshot: "old", introduction: "Fixture", createdAt: now - 1, windowFrom: 1, windowTo: now, model: "fixture", sourceCount: 1 }).returning().get();
  db.insert(topics).values({ id: "old", briefingId: old.id, position: 0, title: "Fixture", summary: "Sintético", itemIds: '["news:available"]' }).run();
  const latest = db.insert(briefings).values({ snapshot: "latest", introduction: "Fixture", createdAt: now, windowFrom: 1, windowTo: now, model: "fixture", sourceCount: 60 }).returning().get();
  const ids = Array.from({ length: 60 }, (_, i) => `cited-${i}`);
  for (const id of ids) add(id, now - 1000);
  db.insert(topics).values({ id: "latest", briefingId: latest.id, position: 0, title: "Fixture", summary: "Sintético", itemIds: JSON.stringify(ids.map(id => `news:${id}`)) }).run();
  expect(outsideItems(db).map(row => row.item.id)).toEqual(["news:available"]);
});
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
it("prioriza temas complementares e mostra manchetes brutas sem fingir análise", () => {
  const db = openDatabase(":memory:"); databases.push(db);
  const personal = db.insert(sources).values({ channelId: "channel", name: "Pessoal" }).returning().get();
  const news = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal", kind: "news_rss", platform: "news" }).returning().get();
  const make = (sourceId: number, platform: "youtube" | "news", id: string, theme?: string, score = 80) => {
    saveRawItems(db, sourceId, [{ platform, externalId: id, title: id, text: "Trecho original", author: "Fonte", url: `https://news.example.com/${id}`, thumbnail: null, publishedAt: Date.now(), newsPublishedAt: platform === "news" ? Date.now() : null, durationSeconds: null, evidence: platform === "news" ? "news_rss" : "rss" }]);
    if (theme) db.insert(processedItems).values({ rawId: `${platform}:${id}`, theme, tone: "informativo", language: "pt", type: "notícia", score, reason: "Teste", summary: "Resumo sintético", isSpam: false, model: "fixture", processedAt: Date.now() }).run();
  };
  make(personal.id, "youtube", "personal", "ciencia-saude");
  make(news.id, "news", "news-science", "ciencia-saude", 99);
  make(news.id, "news", "news-world", "politica-externa", 50);
  make(news.id, "news", "news-raw");
  const rows = outsideItems(db);
  expect(rows).toHaveLength(3);
  expect(rows[0].item.id).toBe("news:news-world");
  expect(rows.find(row => row.item.id === "news:news-raw")?.analysis).toBeNull();
  expect(rows.every(row => row.item.platform === "news")).toBe(true);
});
