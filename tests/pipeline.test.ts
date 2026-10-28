import { afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { openDatabase } from "../src/db/index";
import { sources, interestProfile, processedItems } from "../src/db/schema";
import { saveRawItems, dailyUsage } from "../src/lib/store";
import { getAIConfig } from "../src/lib/config";
import { classifyPending } from "../src/ai/classify";

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.$client.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
function database() {
  const db = openDatabase(":memory:"); databases.push(db);
  const source = db.insert(sources).values({ channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", name: "Ciência" }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "Anúncios", updatedAt: 1 }).run();
  saveRawItems(db, source.id, [{ platform: "youtube", externalId: "abcdefghijk", title: "Aula de ciência", text: "A descrição da aula.", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: 1, durationSeconds: null }]);
  return db;
}
const classification = { items: [{ id: "youtube:abcdefghijk", theme: "Ciência", tone: "informativo", language: "pt", type: "educação", score: 90, reason: "Tema do perfil.", summary: "Uma aula de ciência, segundo a descrição.", isSpam: false }] };
async function endpoint(content: (call: number, body: { messages: { content: string }[] }) => unknown, usage = true) {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "local", object: "chat.completion", model: "custom", created: 1, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content(calls, JSON.parse(body))) }, finish_reason: "stop" }], ...(usage ? { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } : {}) }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta");
  const config = getAIConfig({ AI_PROTOCOL: "openai", AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "test-key", AI_MODEL: "custom" })!;
  return { config, calls: () => calls };
}

describe("pipeline com SQLite e SDK reais", () => {
  it("salva classificação validada e não chama o modelo novamente para o item", async () => {
    const db = database(); const api = await endpoint(() => classification);
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(await classifyPending(db, api.config)).toBe(0);
    expect(api.calls()).toBe(1);
    expect(db.select().from(processedItems).get()).toMatchObject({ rawId: "youtube:abcdefghijk", score: 90 });
    expect(dailyUsage(db)).toMatchObject({ tokens: 150, reserved: 0, calls: 1 });
  });
  it("contabiliza JSON inválido antes de tentar novamente", async () => {
    const db = database(); const api = await endpoint(call => call === 1 ? { items: [] } : classification);
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(api.calls()).toBe(2);
    expect(dailyUsage(db)).toMatchObject({ tokens: 300, calls: 2 });
  });
  it("mantém consumo reservado se o endpoint omitir usage", async () => {
    const db = database(); const api = await endpoint(() => classification, false);
    await classifyPending(db, api.config);
    expect(dailyUsage(db).reserved).toBe(1);
    expect(dailyUsage(db).tokens).toBeGreaterThan(3000);
  });
  it("reduz o lote quando descrições grandes não cabem juntas no teto", async () => {
    const db = database();
    const source = db.select().from(sources).get()!;
    for (let index = 0; index < 5; index++) saveRawItems(db, source.id, [{ platform: "youtube", externalId: `cjkitem${index}`, title: "Aula", text: "界".repeat(5000), author: "Canal", url: `https://www.youtube.com/watch?v=cjkitem${index}`, thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    const api = await endpoint((_call, body) => ({ items: JSON.parse(body.messages[1].content).items.map((item: { id: string }) => ({ ...classification.items[0], id: item.id })) }));
    await classifyPending(db, api.config);
    expect(api.calls()).toBeGreaterThan(1);
    expect(db.select().from(processedItems).all()).toHaveLength(6);
  });
  it("classifica RSS externo sem inventar ou enviar perfil pessoal", async () => {
    const db = openDatabase(":memory:"); databases.push(db);
    const source = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal", kind: "news_rss", platform: "news" }).returning().get();
    saveRawItems(db, source.id, [{ platform: "news", evidence: "news_rss", externalId: "article", title: "Manchete sintética", text: "Trecho original", author: "Portal", url: "https://news.example.com/article", thumbnail: null, publishedAt: Date.now(), durationSeconds: null }]);
    const api = await endpoint((_call, body) => { const input = JSON.parse(body.messages[1].content); expect(input.profile).toBeUndefined(); expect(input.items[0].relevanceScope).toContain("Importância geral"); return { items: [{ ...classification.items[0], id: "news:article" }] }; });
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(db.select().from(interestProfile).all()).toHaveLength(0);
  });
  it("não chama o endpoint quando a reserva supera o teto diário", async () => {
    const db = database(); const api = await endpoint(() => classification);
    await expect(classifyPending(db, { ...api.config, dailyTokenLimit: 1 })).rejects.toThrow(/Limite diário/);
    expect(api.calls()).toBe(0);
    expect(db.select().from(processedItems).all()).toEqual([]);
  });
});
