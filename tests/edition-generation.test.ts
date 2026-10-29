import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { aiCalls, collectorRuns, editions, pushDeliveries, pushSubscriptions, rawItems, sources } from "../src/db/schema";
import { getAIConfig } from "../src/lib/config";
import { saveRawItems } from "../src/lib/store";
import { editionCandidates, runEdition, validateEdition } from "../src/ai/edition";
import { parseNewsFeed } from "../src/collectors/news";

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.$client.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
const base = { localDate: "2026-10-28", edition: "morning" as const, timezone: "America/Sao_Paulo", scheduledAt: Date.parse("2026-10-28T11:00Z"), windowFrom: Date.parse("2026-10-27T11:00Z"), windowTo: Date.parse("2026-10-28T11:00Z"), createdAt: 1 };
const content = { introduction: "Panorama sintético restrito aos RSS fornecidos.", highlights: [{ title: "Destaque sintético", summary: "O RSS relata um acontecimento de teste.", context: "O texto disponível é um trecho RSS, não a reportagem integral.", relevance: "Permite acompanhar uma mudança descrita pela fonte.", itemIds: ["news:new"] }] };
function setup(manual = false) {
  const db = openDatabase(":memory:"); databases.push(db);
  const edition = db.insert(editions).values({ ...base, edition: manual ? "manual" : "morning", slot: "fixture-morning" }).returning().get();
  const run = db.insert(collectorRuns).values({ kind: "edition", editionId: edition.id, status: "running", startedAt: 1 }).returning().get();
  const source = db.insert(sources).values({ channelId: "https://news.example.com/rss", name: "Portal sintético", kind: "news_rss", platform: "news" }).returning().get();
  const item = (externalId: string, publishedAt: number | null) => ({ externalId, platform: "news" as const, evidence: "news_rss" as const, title: `Notícia sintética ${externalId}`, text: "Trecho original sintético.", author: "Portal", url: `https://news.example.com/${externalId}`, thumbnail: null, durationSeconds: null, publishedAt, newsPublishedAt: publishedAt });
  saveRawItems(db, source.id, [item("new", base.windowTo - 3600000), item("old", base.windowFrom - 1), item("future", base.windowTo + 1), item("undated", null)]);
  return { db, edition, run, source };
}

describe("edições ancoradas em RSS públicos", () => {
  it("manual sem notícias novas não chama IA e não aplica limite de atraso", async () => {
    const { db, edition, run } = setup(true);
    db.insert(editions).values({ ...base, slot: "previous", status: "published", itemIds: ["news:new"] }).run();
    const config = getAIConfig({ AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "fixture", AI_MODEL: "fixture" })!;
    await runEdition(db, run.id, config, { collect: async () => [], now: base.scheduledAt + 3 * 3600000 });
    expect(db.select().from(editions).where(eq(editions.id, edition.id)).get()).toMatchObject({ status: "unavailable", notice: expect.stringContaining("Nenhuma notícia datada nova") });
    expect(db.select().from(aiCalls).all()).toEqual([]);
  });
  it("manual exclui IDs e manchetes de qualquer edição publicada nas últimas 24 horas", () => {
    const { db, edition, source } = setup(true);
    saveRawItems(db, source.id, [{ externalId: "reprint", platform: "news", evidence: "news_rss", title: "NOTÍCIA sintética new!", text: "Trecho sintético", author: "Portal", url: "https://news.example.com/reprint", thumbnail: null, durationSeconds: null, publishedAt: base.windowTo - 1, newsPublishedAt: base.windowTo - 1 }]);
    const previous = db.insert(editions).values({ ...base, edition: "afternoon", slot: "previous", status: "published", windowTo: edition.windowFrom + 1, itemIds: ["news:new"] }).returning().get();
    expect(editionCandidates(db, edition).items).toEqual([]);
    expect(editionCandidates(db, edition).morning).toBeNull();
    db.update(editions).set({ windowTo: edition.windowFrom }).where(eq(editions.id, previous.id)).run();
    expect(editionCandidates(db, edition).items).toHaveLength(1);
  });
  it("tarde exclui todas as manuais do dia sem usá-las como contexto da manhã", () => {
    const { db, edition } = setup(true);
    db.update(editions).set({ status: "published", itemIds: ["news:new", "news:future"], content }).where(eq(editions.id, edition.id)).run();
    const afternoon = db.insert(editions).values({ ...base, edition: "afternoon", slot: "afternoon", windowTo: base.windowTo + 8 * 3600000 }).returning().get();
    expect(editionCandidates(db, afternoon).items).toEqual([]);
    expect(editionCandidates(db, afternoon).morning).toBeNull();
  });
  it("exige IDs válidos sem duplicatas e conteúdo editorial completo", () => {
    expect(validateEdition(JSON.stringify(content), ["news:new"])).toEqual(content);
    expect(() => validateEdition(JSON.stringify(content), ["news:invented"])).toThrow();
    expect(() => validateEdition(JSON.stringify({ ...content, highlights: [content.highlights[0], content.highlights[0]] }), ["news:new"])).toThrow();
    expect(() => validateEdition(JSON.stringify({ ...content, highlights: [] }), ["news:new"])).toThrow();
  });
  it("exclui sem-data, antigos, futuros, fontes pausadas e feeds pessoais", () => {
    const { db, edition, source } = setup();
    const personal = db.insert(sources).values({ channelId: "personal-fixture", name: "Feed pessoal sintético", kind: "youtube_home", platform: "youtube" }).returning().get();
    saveRawItems(db, personal.id, [{ externalId: "personal", platform: "youtube", evidence: "youtube_home", title: "Item pessoal que não entra na edição", text: "Fixture", author: "Fixture", url: "https://www.youtube.com/watch?v=fixture", thumbnail: null, durationSeconds: null, publishedAt: base.windowTo - 1000 }]);
    expect(editionCandidates(db, edition).items.map(item => item.id)).toEqual(["news:new"]);
    db.update(sources).set({ enabled: false }).where(eq(sources.id, source.id)).run();
    expect(editionCandidates(db, edition).items).toEqual([]);
  });
  it("trata datas legadas como ambíguas até o RSS comprovar a publicação, sem perder o valor anterior", async () => {
    const { db, edition, source } = setup();
    const originalDate = base.windowTo - 1000;
    saveRawItems(db, source.id, [{ platform: "news", evidence: "news_rss", externalId: "legacy", title: "Manchete legada", text: "Conteúdo preservado", author: "Portal", url: "https://news.example.com/atom-legacy", thumbnail: null, durationSeconds: null, publishedAt: originalDate }]);
    expect(editionCandidates(db, edition).items.some(item => item.id === "news:legacy")).toBe(false);
    const atom = (published = "") => `<feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture</title><entry><title>Manchete atualizada no feed</title><link href="https://news.example.com/atom-legacy"/>${published}<updated>2026-10-28T10:00:00Z</updated></entry></feed>`;
    saveRawItems(db, source.id, await parseNewsFeed(atom(), "Fixture"));
    expect(editionCandidates(db, edition).items.some(item => item.id === "news:legacy")).toBe(false);
    expect(db.select().from(rawItems).where(eq(rawItems.id, "news:legacy")).get()).toMatchObject({ title: "Manchete legada", text: "Conteúdo preservado", publishedAt: originalDate, newsPublishedAt: null });
    saveRawItems(db, source.id, await parseNewsFeed(atom("<published>2026-10-01T10:00:00Z</published>"), "Fixture"));
    const repaired = db.select().from(rawItems).where(eq(rawItems.id, "news:legacy")).get()!;
    expect(repaired).toMatchObject({ title: "Manchete legada", text: "Conteúdo preservado", publishedAt: originalDate, newsPublishedAt: Date.parse("2026-10-01T10:00:00Z") });
    saveRawItems(db, source.id, await parseNewsFeed(atom("<published>2026-10-28T10:00:00Z</published>"), "Fixture"));
    expect(db.select().from(rawItems).where(eq(rawItems.id, "news:legacy")).get()?.newsPublishedAt).toBe(Date.parse("2026-10-01T10:00:00Z"));
    expect(editionCandidates(db, edition).items.some(item => item.id === "news:legacy")).toBe(false);
  });
  it("à tarde exclui IDs e manchetes repetidas da manhã e passa contexto separado", () => {
    const { db, edition, source } = setup();
    saveRawItems(db, source.id, [{ externalId: "reprint", platform: "news", evidence: "news_rss", title: "Notícia sintética new", text: "Reprodução sintética", author: "Outro autor", url: "https://news.example.com/reprint", thumbnail: null, durationSeconds: null, publishedAt: base.windowTo + 1000, newsPublishedAt: base.windowTo + 1000 }]);
    db.update(editions).set({ status: "published", content, itemIds: ["news:new"] }).where(eq(editions.id, edition.id)).run();
    const afternoon = db.insert(editions).values({ ...base, edition: "afternoon", slot: "fixture-afternoon", windowFrom: base.windowTo, windowTo: base.windowTo + 8 * 3600000, scheduledAt: base.windowTo + 8 * 3600000 }).returning().get();
    db.update(rawItems).set({ publishedAt: base.windowTo + 1000, newsPublishedAt: base.windowTo + 1000 }).where(eq(rawItems.id, "news:new")).run();
    expect(editionCandidates(db, afternoon).items.map(item => item.id)).toEqual(["news:future"]);
    expect(editionCandidates(db, afternoon).morning).toMatchObject({ introduction: content.introduction });
  });
  it.each([false, true])("publica e preserva cache; envia push só para edição automática (manual=%s)", async manual => {
    const { db, edition, run } = setup(manual);
    db.insert(pushSubscriptions).values({ id: "fixture-subscription", endpoint: "https://fcm.googleapis.com/fcm/send/fixture", p256dh: "fixture", auth: "fixture", createdAt: 1 }).run();
    let calls = 0;
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      const payload = JSON.parse(JSON.parse(body).messages[1].content);
      expect(payload.items.map((item: { id: string }) => item.id)).toEqual(["news:new"]);
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "local", object: "chat.completion", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
    });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta");
    const config = getAIConfig({ AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "fixture", AI_MODEL: "fixture" })!;
    const collect = async () => [];
    await runEdition(db, run.id, config, { collect, now: base.windowTo });
    await runEdition(db, run.id, config, { collect, now: base.windowTo });
    expect(calls).toBe(1);
    expect(db.select().from(pushDeliveries).all()).toMatchObject(manual ? [] : [{ editionId: edition.id, subscriptionId: "fixture-subscription", status: "queued" }]);
    expect(db.select().from(editions).where(eq(editions.id, edition.id)).get()).toMatchObject({ status: "published", content, itemIds: ["news:new"], attempts: 1 });
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, run.id)).get()?.status).toBe("completed");
  });
  it("sem saldo não chama a rede nem publica uma edição ou notificação", async () => {
    const { db, run } = setup();
    const config = getAIConfig({ AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "fixture", AI_MODEL: "fixture", AI_DAILY_TOKEN_LIMIT: "1" })!;
    await runEdition(db, run.id, config, { collect: async () => [], now: base.windowTo });
    expect(db.select().from(editions).get()).toMatchObject({ status: "error", content: null });
    expect(db.select().from(editions).get()?.notice).toMatch(/Limite diário/);
    expect(db.select().from(aiCalls).all()).toEqual([]);
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
  });
  it("recusa duas respostas inválidas sem publicar conteúdo parcial e contabiliza ambas", async () => {
    const { db, run } = setup();
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* Consumir a solicitação local de fixture. */ }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "local", object: "chat.completion", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta");
    const config = getAIConfig({ AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "fixture", AI_MODEL: "fixture" })!;
    await runEdition(db, run.id, config, { collect: async () => [], now: base.windowTo });
    expect(db.select().from(editions).get()).toMatchObject({ status: "error", content: null, itemIds: [] });
    expect(db.select().from(aiCalls).all()).toHaveLength(2);
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
  });
  it("preserva o motivo de configuração recebido sem inventar edição", async () => {
    const { db, run } = setup();
    const briefingNotice = "Configure AI_BASE_URL para gerar briefings.";
    await runEdition(db, run.id, null, { collect: async () => [], now: base.windowTo, briefingNotice });
    expect(db.select().from(editions).get()).toMatchObject({ status: "unavailable", content: null, notice: briefingNotice });
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, run.id)).get()?.error).toBe(briefingNotice);
    expect(db.select().from(aiCalls).all()).toEqual([]);
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
  });
  it("sem fontes não inventa edição", async () => {
    const { db, run, source } = setup();
    db.update(sources).set({ enabled: false }).where(eq(sources.id, source.id)).run();
    await runEdition(db, run.id, null, { now: base.windowTo });
    expect(db.select().from(editions).get()).toMatchObject({ status: "unavailable", content: null });
    expect(db.select().from(editions).get()?.notice).toMatch(/RSS/);
  });
  it("não finaliza nem publica a execução de outro dono após perder o lease na coleta", async () => {
    const { db, run } = setup();
    let lost = false;
    await expect(runEdition(db, run.id, null, { now: base.windowTo, assertActive: () => { if (lost) throw new Error("lease perdido"); }, collect: async () => { lost = true; return []; } })).rejects.toThrow("lease perdido");
    expect(db.select().from(editions).get()).toMatchObject({ status: "running", content: null });
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, run.id)).get()?.status).toBe("running");
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
  });
  it("reinícios são limitados e execução muito atrasada não envia panorama velho", async () => {
    const { db, run, edition } = setup();
    db.update(editions).set({ attempts: 2, status: "running" }).where(eq(editions.id, edition.id)).run();
    await runEdition(db, run.id, null, { now: base.windowTo });
    expect(db.select().from(editions).get()).toMatchObject({ status: "error", attempts: 2 });
    const second = setup();
    await runEdition(second.db, second.run.id, null, { now: base.windowTo + 3 * 3600000 });
    expect(second.db.select().from(editions).get()?.notice).toMatch(/atraso/);
  });
});
