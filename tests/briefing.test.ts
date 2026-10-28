import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { sources, rawItems, processedItems, interestProfile, briefings, topics, sourceItems } from "../src/db/schema";
import { generateBriefing, validateBriefing } from "../src/ai/briefing";
import { getAIConfig, getBriefingConfig } from "../src/lib/config";
import { dailyUsage, saveRawItems } from "../src/lib/store";

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.$client.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
const valid = { introduction: "Este é um recorte do seu feed, não um panorama completo do mundo.", topics: [{ title: "Ciência no seu feed", summary: "O canal apresenta uma aula de ciência, segundo o título e a descrição coletados.", itemIds: ["youtube:item"] }] };

describe("briefing ancorado nas fontes", () => {
  it("não escolhe modelo de briefing silenciosamente", () => {
    expect(getBriefingConfig({ AI_BASE_URL: "https://example.com", AI_API_KEY: "key", AI_MODEL: "classification" })).toBeNull();
  });
  it("exige cada fonte solicitada exatamente uma vez e rejeita IDs inventados", () => {
    expect(validateBriefing(JSON.stringify(valid), ["youtube:item"])).toEqual(valid);
    expect(() => validateBriefing(JSON.stringify(valid), ["outro"])).toThrow();
    expect(() => validateBriefing(JSON.stringify({ ...valid, topics: [valid.topics[0], valid.topics[0]] }), ["youtube:item"])).toThrow();
    expect(() => validateBriefing(JSON.stringify({ ...valid, topics: [] }), ["youtube:item"])).toThrow();
  });
  it("integra briefing com cache, retry, orçamento e preservação do histórico", async () => {
    const db = openDatabase(":memory:"); databases.push(db);
    const source = db.insert(sources).values({ channelId: "channel", name: "Canal" }).returning().get();
    db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run();
    db.insert(rawItems).values({ id: "youtube:item", sourceId: source.id, externalId: "item", platform: "youtube", title: "Aula de ciência", text: "Descrição da aula", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", fetchedAt: Date.now() }).run();
    db.insert(processedItems).values({ rawId: "youtube:item", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Perfil", summary: "Aula de ciência", isSpam: false, model: "fixture", processedAt: 1 }).run();
    db.insert(sourceItems).values({ sourceId: source.id, rawId: "youtube:item" }).run();
    const news = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal", platform: "news", kind: "news_rss" }).returning().get();
    saveRawItems(db, news.id, [{ platform: "news", evidence: "news_rss", externalId: "external", title: "Notícia externa", text: "Não é o algoritmo pessoal", author: "Portal", url: "https://news.example.com/external", thumbnail: null, publishedAt: Date.now(), durationSeconds: null }]);
    db.insert(processedItems).values({ rawId: "news:external", theme: "politica-externa", tone: "informativo", language: "pt", type: "notícia", score: 100, reason: "Geral", summary: "Notícia externa", isSpam: false, model: "fixture", processedAt: 1 }).run();
    let calls = 0;
    let invalidResponses = 0;
    const requests: { items: { id: string; description: string }[] }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(JSON.parse(body).messages[1].content);
      requests.push(payload);
      const result = invalidResponses > 0 ? { ...valid, topics: [] } : { ...valid, topics: [{ ...valid.topics[0], itemIds: payload.items.map((item: { id: string }) => item.id) }] };
      if (invalidResponses > 0) invalidResponses--;
      calls++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "local", object: "chat.completion", created: 1, model: "briefing", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta");
    const config = getAIConfig({ AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "test-key", AI_MODEL: "briefing" })!;
    expect(await generateBriefing(db, config)).toBe(true);
    expect(await generateBriefing(db, config)).toBe(false);
    expect(await generateBriefing(db, { ...config, dailyTokenLimit: 1 })).toBe(false);
    expect(calls).toBe(1);
    expect(db.select().from(briefings).all()).toHaveLength(1);
    expect(db.select().from(topics).get()?.title).toBe("Ciência no seu feed");
    expect(db.select().from(processedItems).get()?.clusterId).toBeTruthy();
    expect(dailyUsage(db).tokens).toBe(200);
    expect(requests[0].items[0].description).toBe("Descrição da aula");
    expect(requests[0].items.map(item => item.id)).toEqual(["youtube:item"]);

    db.update(rawItems).set({ title: "Aula atualizada" }).where(eq(rawItems.id, "youtube:item")).run();
    invalidResponses = 1;
    expect(await generateBriefing(db, config)).toBe(true);
    expect(calls).toBe(3);
    expect(db.select().from(briefings).all()).toHaveLength(2);
    expect(dailyUsage(db).tokens).toBe(600);

    db.update(rawItems).set({ title: "Outra atualização" }).where(eq(rawItems.id, "youtube:item")).run();
    invalidResponses = 2;
    await expect(generateBriefing(db, config)).rejects.toThrow(/JSON inválido/);
    expect(calls).toBe(5);
    expect(db.select().from(briefings).all()).toHaveLength(2);
    await expect(generateBriefing(db, { ...config, dailyTokenLimit: 1 })).rejects.toThrow(/Limite diário/);
    expect(calls).toBe(5);
    expect(db.select().from(briefings).all()).toHaveLength(2);

    db.update(rawItems).set({ text: "x".repeat(6000) }).where(eq(rawItems.id, "youtube:item")).run();
    db.insert(rawItems).values({ id: "youtube:second", sourceId: source.id, externalId: "second", platform: "youtube", title: "Outra aula", text: "x".repeat(6000), author: "Canal", url: "https://www.youtube.com/watch?v=secondvideo", fetchedAt: Date.now() }).run();
    db.insert(processedItems).values({ rawId: "youtube:second", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 70, reason: "Perfil", summary: "Outra aula", isSpam: false, model: "fixture", processedAt: 1 }).run();
    db.insert(sourceItems).values({ sourceId: source.id, rawId: "youtube:second" }).run();
    expect(await generateBriefing(db, { ...config, dailyTokenLimit: 15000 })).toBe(true);
    expect(db.select().from(briefings).orderBy(desc(briefings.id)).get()).toMatchObject({ sourceCount: 1, candidateCount: 2, budgetLimited: true });
    expect(await generateBriefing(db, config)).toBe(false);
    expect(calls).toBe(6);
  });
});
