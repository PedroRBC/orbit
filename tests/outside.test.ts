import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/index";
import { sources, processedItems } from "../src/db/schema";
import { saveRawItems } from "../src/lib/store";
import { outsideItems } from "../src/lib/outside";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
it("prioriza temas complementares e mostra manchetes brutas sem fingir análise", () => {
  const db = openDatabase(":memory:"); databases.push(db);
  const personal = db.insert(sources).values({ channelId: "channel", name: "Pessoal" }).returning().get();
  const news = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal", kind: "news_rss", platform: "news" }).returning().get();
  const make = (sourceId: number, platform: "youtube" | "news", id: string, theme?: string, score = 80) => {
    saveRawItems(db, sourceId, [{ platform, externalId: id, title: id, text: "Trecho original", author: "Fonte", url: `https://news.example.com/${id}`, thumbnail: null, publishedAt: Date.now(), durationSeconds: null, evidence: platform === "news" ? "news_rss" : "rss" }]);
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
