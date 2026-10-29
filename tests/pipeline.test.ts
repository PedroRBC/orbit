import { afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { openDatabase } from "../src/db/index";
import { sources, interestProfile, processedItems } from "../src/db/schema";
import { saveRawItems, dailyUsage } from "../src/lib/store";
import { getAIConfig } from "../src/lib/config";
import { classifyPending } from "../src/ai/classify";
import { SEED_THEMES } from "../src/lib/taxonomy";
import { mergeTheme } from "../src/lib/themes";

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
const classification = { items: [{ id: "youtube:abcdefghijk", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 90, reason: "Tema do perfil.", summary: "Uma aula de ciência, segundo a descrição.", isSpam: false }] };
async function endpoint(content: (call: number, body: { messages: { content: string }[] }) => unknown, usage = true) {
  let calls = 0;
  const requests: { messages: { content: string }[] }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls++;
    requests.push(JSON.parse(body));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "local", object: "chat.completion", model: "custom", created: 1, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(await content(calls, JSON.parse(body))) }, finish_reason: "stop" }], ...(usage ? { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } : {}) }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta");
  const config = getAIConfig({ AI_PROTOCOL: "openai", AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "test-key", AI_MODEL: "custom" })!;
  return { config, calls: () => calls, requests };
}

describe("pipeline com SQLite e SDK reais", () => {
  it("salva classificação validada e não chama o modelo novamente para o item", async () => {
    const db = database(); const api = await endpoint(() => classification);
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(await classifyPending(db, api.config)).toBe(0);
    expect(api.calls()).toBe(1);
    expect(db.select().from(processedItems).get()).toMatchObject({ rawId: "youtube:abcdefghijk", theme: "ciencia-saude", score: 90 });
    expect(dailyUsage(db)).toMatchObject({ tokens: 150, reserved: 0, calls: 1 });
  });
  for (const [id, label] of [["automotivo", "Automotivo"], ["automotivo-2", "Automotivo 日"]]) {
    it.each(["id", "rótulo", "alias"])(`preserva resposta paga ao juntar ${id} durante a classificação por %s`, async reply => {
      const db = database();
      const insert = db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin, aliases) VALUES (?, ?, 'ai', ?)");
      if (id.endsWith("-2")) insert.run("automotivo", "Automotivo", "[]");
      insert.run(id, label, '["Motores sintéticos"]');
      let release!: () => void, received!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const requested = new Promise<void>(resolve => { received = resolve; });
      const attempts = reply === "id" ? 1 : 2;
      const api = await endpoint(async (call, body) => {
        if (call < attempts) return { items: [] };
        expect(JSON.parse(body.messages[1].content).themes).toContainEqual({ id, label });
        received(); await held;
        return { items: [{ ...classification.items[0], theme: reply === "id" ? id : reply === "rótulo" ? label : "Motores sintéticos" }] };
      });
      const pending = classifyPending(db, api.config);
      await requested;
      try {
        db.transaction(() => {
          // O destino criado durante a chamada não pertence ao catálogo enviado.
          insert.run("destino-sintetico", "Destino sintético", "[]");
          mergeTheme(db, id, "destino-sintetico");
        }, { behavior: "immediate" });
      } finally { release(); }
      await expect(pending).resolves.toBe(1);
      expect(db.select().from(processedItems).all()).toEqual([expect.objectContaining({ rawId: "youtube:abcdefghijk", theme: "destino-sintetico", score: 90 })]);
      expect(await classifyPending(db, api.config)).toBe(0);
      expect(api.calls()).toBe(attempts);
      expect(dailyUsage(db)).toMatchObject({ tokens: 150 * attempts, reserved: 0, calls: attempts });
      expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    });
  }
  it("preserva resposta paga em Outros se o tema removido não tem mais alias", async () => {
    const db = database();
    db.$client.exec("INSERT INTO taxonomy_themes (id, label, origin) VALUES ('automotivo-2', 'Automotivo 日', 'ai')");
    const api = await endpoint(() => {
      db.transaction(() => db.$client.exec("DELETE FROM taxonomy_themes WHERE id = 'automotivo-2'"), { behavior: "immediate" });
      return { items: [{ ...classification.items[0], theme: "automotivo-2" }] };
    });
    await expect(classifyPending(db, api.config)).resolves.toBe(1);
    expect(db.select().from(processedItems).get()?.theme).toBe("outros");
    expect(await classifyPending(db, api.config)).toBe(0);
    expect(api.calls()).toBe(1);
    expect(dailyUsage(db)).toMatchObject({ tokens: 150, reserved: 0, calls: 1 });
  });
  it("contabiliza JSON inválido antes de tentar novamente", async () => {
    const db = database(); const api = await endpoint(call => call === 1 ? { items: [] } : classification);
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(api.calls()).toBe(2);
    expect(dailyUsage(db)).toMatchObject({ tokens: 300, calls: 2 });
  });
  it("catálogo vai na mensagem de usuário com propostas e pesos canônicos", async () => {
    const db = database();
    db.update(interestProfile).set({ weights: '{"tecnologia":2.5}' }).run();
    const api = await endpoint(call => call === 1 ? { items: [{ ...classification.items[0], theme: "tema inventado" }] } : classification);
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(api.calls()).toBe(2);
    for (const body of api.requests) {
      expect(body.messages[0].content).not.toContain("Catálogo permitido");
      const input = JSON.parse(body.messages[1].content);
      expect(input.themes).toEqual(SEED_THEMES);
      expect(input.proposedThemes).toEqual([]);
      expect(input.profile.learnedThemeWeights).toEqual({ tecnologia: 2.5 });
    }
    expect(db.select().from(processedItems).get()?.theme).toBe("ciencia-saude");
  });
  it.each([["Ciência", "ciencia-saude"], ["inventado", "outros"]])("segunda resposta inválida resolve tema desconhecido: %s", async (theme, expected) => {
    const db = database(); const api = await endpoint(call => ({ items: [{ ...classification.items[0], theme: call === 1 ? "Ciência" : theme }] }));
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(api.calls()).toBe(2);
    expect(db.select().from(processedItems).get()?.theme).toBe(expected);
    expect(dailyUsage(db)).toMatchObject({ tokens: 300, calls: 2 });
  });
  it("preserva a pendência após dois JSONs estruturalmente inválidos", async () => {
    const db = database(); const api = await endpoint(() => ({ items: [] }));
    await expect(classifyPending(db, api.config)).rejects.toThrow(/inválido duas vezes/);
    expect(db.select().from(processedItems).all()).toEqual([]);
  });
  it("lote com newTheme grava proposta e tema existente", async () => {
    const db = database(); const api = await endpoint(() => ({ items: [{ ...classification.items[0], newTheme: { label: "Automotivo", aliases: ["Carros"] } }] }));
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(db.select().from(processedItems).get()?.theme).toBe("ciencia-saude");
    expect(db.$client.prepare("SELECT raw_id, label, aliases FROM theme_proposals").all()).toEqual([{ raw_id: "youtube:abcdefghijk", label: "Automotivo", aliases: '["Carros"]' }]);
  });
  it.each([true, false])("spam não propõe antes do insert; rótulo existente substitui o tema pessoal: spam=%s", async isSpam => {
    const db = database(); const api = await endpoint(() => ({ items: [{ ...classification.items[0], isSpam, newTheme: { label: isSpam ? "Automotivo" : "Educação" } }] }));
    await classifyPending(db, api.config);
    expect(db.$client.prepare("SELECT count(*) FROM theme_proposals").pluck().get()).toBe(0);
    expect(db.select().from(processedItems).get()).toMatchObject({ isSpam, theme: isSpam ? "ciencia-saude" : "sociedade-cotidiano" });
  });
  it("recalcula catálogo e observação por lote e aceita o tema recém-criado", async () => {
    const db = database(); const source = db.select().from(sources).get()!;
    for (let i = 0; i < 10; i++) saveRawItems(db, source.id, [{ platform: "youtube", externalId: `synthetic-${i}`, title: "Fixture sintética", text: "", author: "Fixture", url: `https://example.com/synthetic-${i}`, thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    const api = await endpoint((call, body) => {
      const input = JSON.parse(body.messages[1].content);
      return { items: input.items.map((item: { id: string }, index: number) => ({ ...classification.items[0], id: item.id, theme: call > 1 ? "automotivo" : "outros", ...(call === 1 ? { newTheme: { label: index < 3 ? "Automotivo" : "Aviação" } } : {}) })) };
    });
    expect(await classifyPending(db, api.config)).toBe(11);
    expect(api.calls()).toBe(3);
    const second = JSON.parse(api.requests[1].messages[1].content);
    expect(second.themes.at(-1)).toEqual({ id: "automotivo", label: "Automotivo" });
    expect(second.proposedThemes).toEqual(["Aviação"]);
    expect(db.$client.prepare("SELECT count(*) FROM processed_items WHERE theme = 'automotivo'").pluck().get()).toBe(9);
  });
  it("ordena pendências por coleta mais recente", async () => {
    const db = database(); const source = db.select().from(sources).get()!;
    saveRawItems(db, source.id, [{ platform: "youtube", externalId: "newest-synthetic", title: "Fixture sintética", text: "", author: "Fixture", url: "https://example.com/newest-synthetic", thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    db.$client.exec("UPDATE raw_items SET fetchedAt = CASE externalId WHEN 'newest-synthetic' THEN 20 ELSE 10 END");
    const api = await endpoint((_call, body) => ({ items: JSON.parse(body.messages[1].content).items.map((item: { id: string }) => ({ ...classification.items[0], id: item.id })) }));
    await classifyPending(db, api.config);
    expect(JSON.parse(api.requests[0].messages[1].content).items.map((item: { id: string }) => item.id)).toEqual(["youtube:newest-synthetic", "youtube:abcdefghijk"]);
  });
  it("falha na promoção desfaz propostas e itens do lote na mesma transação", async () => {
    const db = database(); const source = db.select().from(sources).get()!;
    for (let i = 0; i < 2; i++) saveRawItems(db, source.id, [{ platform: "youtube", externalId: `rollback-${i}`, title: "Fixture sintética", text: "", author: "Fixture", url: `https://example.com/rollback-${i}`, thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    db.$client.exec("CREATE TRIGGER synthetic_promotion_failure BEFORE INSERT ON taxonomy_themes BEGIN SELECT RAISE(ABORT, 'falha sintética'); END");
    const api = await endpoint((_call, body) => ({ items: JSON.parse(body.messages[1].content).items.map((item: { id: string }) => ({ ...classification.items[0], id: item.id, newTheme: { label: "Automotivo" } })) }));
    await expect(classifyPending(db, api.config)).rejects.toThrow("falha sintética");
    expect(db.select().from(processedItems).all()).toEqual([]);
    expect(db.$client.prepare("SELECT * FROM theme_proposals").all()).toEqual([]);
    expect(dailyUsage(db)).toMatchObject({ tokens: 150, calls: 1 });
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
  it("notícias antigas, sem data ou futuras não são classificadas, mas publicação legada não invalida data comprovada recente", async () => {
    const db = database(), now = Date.now();
    const news = db.insert(sources).values({ channelId: "https://fixture.example/rss", name: "Portal sintético", platform: "news", kind: "news_rss" }).returning().get();
    for (const [id, newsPublishedAt] of [["old", now - 48 * 3600000 - 1000], ["undated", null], ["future", now + 60000], ["recent", now - 1000]] as const) saveRawItems(db, news.id, [{ platform: "news", evidence: "news_rss", externalId: id, title: "Fixture sintética", text: "Trecho", author: "Teste", url: `https://fixture.example/${id}`, thumbnail: null, publishedAt: id === "recent" ? 1 : now, newsPublishedAt, durationSeconds: null }]);
    const api = await endpoint((_call, body) => ({ items: JSON.parse(body.messages[1].content).items.map((item: { id: string }) => ({ ...classification.items[0], id: item.id, newTheme: { label: "Automotivo" } })) }));
    expect(await classifyPending(db, api.config)).toBe(2);
    expect(db.select().from(processedItems).all().map(item => item.rawId).sort()).toEqual(["news:recent", "youtube:abcdefghijk"]);
    expect(db.$client.prepare("SELECT raw_id FROM theme_proposals").all()).toEqual([{ raw_id: "youtube:abcdefghijk" }]);
  });
  it("descrição de notícia limitada a 1.500 sem cortar a descrição pessoal", async () => {
    const db = database(), source = db.select().from(sources).get()!;
    saveRawItems(db, source.id, [{ platform: "youtube", externalId: "long-personal", title: "Fixture pessoal", text: "a".repeat(1800), author: "Canal", url: "https://fixture.example/personal", thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    const news = db.insert(sources).values({ channelId: "https://fixture.example/rss", name: "Portal sintético", platform: "news", kind: "news_rss" }).returning().get();
    saveRawItems(db, news.id, [{ platform: "news", evidence: "news_rss", externalId: "long-news", title: "Fixture RSS", text: "界".repeat(2000), author: "Portal", url: "https://fixture.example/news", thumbnail: null, publishedAt: 1, newsPublishedAt: Date.now(), durationSeconds: null }]);
    const api = await endpoint((_call, body) => ({ items: JSON.parse(body.messages[1].content).items.map((item: { id: string }) => ({ ...classification.items[0], id: item.id })) }));
    await classifyPending(db, api.config);
    const items = api.requests.flatMap(body => JSON.parse(body.messages[1].content).items) as { id: string; description: string }[];
    expect(items.find(item => item.id === "news:long-news")?.description).toHaveLength(1500);
    expect(items.find(item => item.id === "youtube:long-personal")?.description).toHaveLength(1800);
  });
  it("classifica RSS externo sem inventar ou enviar perfil pessoal", async () => {
    const db = openDatabase(":memory:"); databases.push(db);
    const source = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal", kind: "news_rss", platform: "news" }).returning().get();
    saveRawItems(db, source.id, [{ platform: "news", evidence: "news_rss", externalId: "article", title: "Manchete sintética", text: "Trecho original", author: "Portal", url: "https://news.example.com/article", thumbnail: null, publishedAt: Date.now(), newsPublishedAt: Date.now(), durationSeconds: null }]);
    const api = await endpoint((_call, body) => { const input = JSON.parse(body.messages[1].content); expect(input.profile).toBeUndefined(); expect(input.items[0].relevanceScope).toContain("Importância geral"); return { items: [{ ...classification.items[0], id: "news:article", newTheme: { label: "Automotivo" } }] }; });
    expect(await classifyPending(db, api.config)).toBe(1);
    expect(db.select().from(interestProfile).all()).toHaveLength(0);
    expect(db.$client.prepare("SELECT * FROM theme_proposals").all()).toEqual([]);
  });
  it("não chama o endpoint quando a reserva supera o teto diário", async () => {
    const db = database(); const api = await endpoint(() => classification);
    await expect(classifyPending(db, { ...api.config, dailyTokenLimit: 1 })).rejects.toThrow(/Limite diário/);
    expect(api.calls()).toBe(0);
    expect(db.select().from(processedItems).all()).toEqual([]);
  });
});
