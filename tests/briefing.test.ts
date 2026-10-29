import { describe, expect, it, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { sources, rawItems, processedItems, interestProfile, briefings, topics, sourceItems, collectorRuns } from "../src/db/schema";
import { generateBriefing, validateBriefing } from "../src/ai/briefing";
import { getAIConfig, getBriefingConfig } from "../src/lib/config";
import { dailyUsage, getSetting, saveRawItems, setSetting } from "../src/lib/store";
import { runWithConfiguredAI } from "../src/lib/run";
import { estimateRequest } from "../src/ai/request";

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const db of databases.splice(0)) db.$client.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
const valid = { introduction: "Este é um recorte do seu feed, não um panorama completo do mundo.", topics: [{ title: "Ciência no seu feed", summary: "O canal apresenta uma aula de ciência, segundo o título e a descrição coletados.", itemIds: ["youtube:item"] }] };
function rssFixture(personal = true) {
  const db = openDatabase(":memory:"); databases.push(db);
  db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "Anúncios", weights: '{"politica-externa":20}', updatedAt: 1 }).run();
  const personalSource = db.insert(sources).values({ channelId: "personal-fixture", name: "Pessoal" }).returning().get();
  const newsSource = db.insert(sources).values({ channelId: "https://fixture.example/rss", name: "Portal sintético", platform: "news", kind: "news_rss" }).returning().get();
  const add = (id: string, options: { sourceId?: number; title?: string; publishedAt?: number | null; newsPublishedAt?: number | null; score?: number; analyzed?: boolean; spam?: boolean; evidence?: "rss" | "news_rss" } = {}) => {
    const platform = id.startsWith("news:") ? "news" : "youtube";
    const sourceId = options.sourceId ?? (platform === "news" ? newsSource.id : personalSource.id);
    saveRawItems(db, sourceId, [{ platform, evidence: options.evidence ?? (platform === "news" ? "news_rss" : "rss"), externalId: id.split(":")[1], title: options.title ?? id, text: platform === "news" ? "界".repeat(2000) : "Descrição pessoal", author: "Fonte sintética", url: `https://fixture.example/${id}`, thumbnail: null, publishedAt: options.publishedAt === undefined ? 1 : options.publishedAt, newsPublishedAt: options.newsPublishedAt === undefined ? Date.now() - 1000 : options.newsPublishedAt, durationSeconds: null }]);
    if (options.analyzed !== false) db.insert(processedItems).values({ rawId: id, theme: "politica-externa", tone: "informativo", language: "pt", type: "notícia", score: options.score ?? 80, reason: "Fixture", summary: "Resumo sintético", isSpam: options.spam ?? false, model: "fixture", processedAt: 1 }).run();
  };
  if (personal) add("youtube:item");
  return { db, add, newsSource };
}
type BriefingPayload = { items: { id: string; external?: boolean; description: string; publishedAt: number | null }[] };
async function briefingEndpoint(result: (input: BriefingPayload) => unknown = input => ({ ...valid, topics: [{ ...valid.topics[0], itemIds: input.items.map(item => item.id) }] })) {
  const requests: BriefingPayload[] = [];
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    const input = JSON.parse(JSON.parse(body).messages[1].content); requests.push(input);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "local", object: "chat.completion", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result(input)) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta");
  return { requests, config: getAIConfig({ AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "fixture", AI_MODEL: "fixture" })! };
}

describe("briefing ancorado nas fontes", () => {
  it("inclui até 3 RSS datados e marcados, preferindo fontes e deduplicando manchetes", async () => {
    const { db, add } = rssFixture(), api = await briefingEndpoint();
    const second = db.insert(sources).values({ channelId: "https://second.example/rss", name: "Segundo", kind: "news_rss", platform: "news" }).returning().get();
    const third = db.insert(sources).values({ channelId: "https://third.example/rss", name: "Terceiro", kind: "news_rss", platform: "news" }).returning().get();
    add("news:first", { title: "Fato concreto!", score: 100, newsPublishedAt: Date.now() - 2000 });
    add("news:duplicate", { title: "FATO CONCRETO", score: 99, sourceId: second.id });
    add("news:same-source", { score: 98 });
    add("news:second", { score: 40, sourceId: second.id });
    add("news:third", { score: 30, sourceId: third.id });
    expect(await generateBriefing(db, api.config)).toBe("created");
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item", "news:first", "news:second", "news:third"]);
    expect(api.requests[0].items[0].external).not.toBe(true);
    for (const item of api.requests[0].items.slice(1)) {
      expect(item.external).toBe(true);
      expect(item.description).toHaveLength(1500);
      expect(item.publishedAt).toBe(db.select().from(rawItems).where(eq(rawItems.id, item.id)).get()!.newsPublishedAt);
    }
    expect(getSetting(db, "briefing_external_notice")).toBe("");
  });
  it("ordena RSS por nota geral sem aplicar pesos pessoais e conta apenas as fontes citadas", async () => {
    const { db, add } = rssFixture(), api = await briefingEndpoint(() => valid);
    db.update(interestProfile).set({ weights: '{"politica-externa":-20,"ciencia-saude":20}' }).run();
    add("news:high", { score: 90 }); add("news:low", { score: 60 });
    db.update(processedItems).set({ theme: "ciencia-saude" }).where(eq(processedItems.rawId, "news:low")).run();
    await generateBriefing(db, api.config);
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item", "news:high", "news:low"]);
    expect(db.select().from(briefings).get()).toMatchObject({ sourceCount: 1, candidateCount: 3, budgetLimited: false });
  });
  it("aviso externo e briefing são publicados na mesma transação", async () => {
    const { db } = rssFixture(), api = await briefingEndpoint();
    setSetting(db, "briefing_external_notice", "Aviso anterior sintético");
    db.$client.exec("CREATE TRIGGER synthetic_briefing_failure BEFORE INSERT ON briefings BEGIN SELECT RAISE(ABORT, 'falha sintética'); END");
    await expect(generateBriefing(db, api.config)).rejects.toThrow("falha sintética");
    expect(getSetting(db, "briefing_external_notice")).toBe("Aviso anterior sintético");
    expect(db.select().from(briefings).all()).toEqual([]);
  });
  it("completa as 3 externas com a mesma fonte quando necessário e ordena empates pela publicação comprovada", async () => {
    const { db, add } = rssFixture(), api = await briefingEndpoint(), now = Date.now();
    add("news:older", { newsPublishedAt: now - 3000 }); add("news:newer", { newsPublishedAt: now - 1000 }); add("news:middle", { newsPublishedAt: now - 2000 });
    await generateBriefing(db, api.config);
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item", "news:newer", "news:middle", "news:older"]);
  });
  it("exclui RSS sem data, antigo, futuro, spam, não analisado ou sem vínculo ativo", async () => {
    const { db, add } = rssFixture(), api = await briefingEndpoint();
    add("news:undated", { newsPublishedAt: null }); add("news:old", { newsPublishedAt: Date.now() - 86400001 });
    add("news:future", { newsPublishedAt: Date.now() + 60000 }); add("news:spam", { spam: true });
    add("news:pending", { analyzed: false }); add("news:unproven", { evidence: "rss" }); add("news:inactive");
    db.delete(sourceItems).where(eq(sourceItems.rawId, "news:inactive")).run();
    const paused = db.insert(sources).values({ channelId: "https://paused.example/rss", name: "Pausado", enabled: false, kind: "news_rss", platform: "news" }).returning().get();
    add("news:paused", { sourceId: paused.id });
    await generateBriefing(db, api.config);
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item"]);
  });
  it("aceita vínculo ativo alternativo sem exigir que a primeira origem esteja ativa", async () => {
    const { db, add, newsSource } = rssFixture(), api = await briefingEndpoint();
    add("news:shared"); db.update(sources).set({ enabled: false }).where(eq(sources.id, newsSource.id)).run();
    const active = db.insert(sources).values({ channelId: "https://active.example/rss", name: "Ativo", kind: "news_rss", platform: "news" }).returning().get();
    db.insert(sourceItems).values({ sourceId: active.id, rawId: "news:shared" }).run();
    await generateBriefing(db, api.config);
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item", "news:shared"]);
  });
  it("sem item pessoal não há briefing nem chamada de rede", async () => {
    const { db, add } = rssFixture(false), api = await briefingEndpoint(); add("news:only");
    expect(await generateBriefing(db, api.config)).toBe("no_personal");
    expect(api.requests).toEqual([]); expect(dailyUsage(db).calls).toBe(0);
  });
  it("externo omitido é aceito, pessoal omitido e IDs repetidos ou inventados são rejeitados", () => {
    expect(validateBriefing(JSON.stringify(valid), ["youtube:item"], ["news:optional"])).toEqual(valid);
    const withIds = (itemIds: string[]) => JSON.stringify({ ...valid, topics: [{ ...valid.topics[0], itemIds }] });
    expect(() => validateBriefing(withIds(["news:optional"]), ["youtube:item"], ["news:optional"])).toThrow(/Fontes/);
    expect(() => validateBriefing(withIds(["youtube:item", "news:optional"]), ["youtube:item"], ["news:optional"])).not.toThrow();
    for (const ids of [["youtube:item", "news:optional", "news:optional"], ["youtube:item", "inventado"], ["youtube:item", "youtube:item"]]) expect(() => validateBriefing(withIds(ids), ["youtube:item"], ["news:optional"])).toThrow(/Fontes/);
  });
  it.each(["none", "undated", "pending", "omitted"])("aviso quando não há externas: %s", async reason => {
    const { db, add, newsSource } = rssFixture(), api = await briefingEndpoint(() => valid);
    if (reason === "none") db.update(sources).set({ enabled: false }).where(eq(sources.id, newsSource.id)).run();
    if (reason === "undated") add("news:undated", { newsPublishedAt: null });
    if (reason === "pending") add("news:pending", { analyzed: false });
    if (reason === "omitted") add("news:omitted");
    await generateBriefing(db, api.config);
    const messages = { none: "Nenhum RSS externo ativo", undated: "Nenhuma notícia RSS com data de publicação comprovada nas últimas 24 horas", pending: "aguardando análise", omitted: "O modelo não citou nenhuma notícia externa" };
    expect(getSetting(db, "briefing_external_notice")).toContain(messages[reason as keyof typeof messages]);
    expect(db.select().from(briefings).get()?.sourceCount).toBe(1);
    expect(await generateBriefing(db, api.config)).toBe("unchanged");
    expect(api.requests).toHaveLength(1);
    expect(getSetting(db, "briefing_external_notice")).toContain(messages[reason as keyof typeof messages]);
  });
  it("orçamento corta RSS antes do pessoal e nunca gera só com externas", async () => {
    const { db, add } = rssFixture(), api = await briefingEndpoint();
    add("news:expensive");
    const prompt = readFileSync(join(process.cwd(), "prompts/briefing.md"), "utf8");
    const item = db.select().from(rawItems).where(eq(rawItems.id, "youtube:item")).get()!;
    const payload = { profile: { interests: "Ciência", excluded: "Anúncios", learnedThemeWeights: { "politica-externa": 20 } }, dayUTC: new Date().toISOString().slice(0, 10), items: [{ id: item.id, title: item.title, summary: "Resumo sintético", description: item.text, author: item.author, platform: item.platform, publishedAt: item.publishedAt }] };
    const personalLimit = estimateRequest(api.config, prompt, JSON.stringify(payload)).tokens + 100;
    expect(await generateBriefing(db, { ...api.config, dailyTokenLimit: personalLimit })).toBe("created");
    expect(api.requests[0].items.map(item => item.id)).toEqual(["youtube:item"]);
    expect(db.select().from(briefings).get()).toMatchObject({ budgetLimited: true, sourceCount: 1, candidateCount: 2 });
    db.update(rawItems).set({ text: "界".repeat(10000) }).where(eq(rawItems.id, "youtube:item")).run();
    const external = db.select().from(rawItems).where(eq(rawItems.id, "news:expensive")).get()!;
    const externalPayload = { ...payload, items: [{ id: external.id, title: external.title, summary: "Resumo sintético", description: external.text.slice(0, 1500), author: external.author, platform: external.platform, publishedAt: external.newsPublishedAt, external: true }] };
    expect(dailyUsage(db).tokens + estimateRequest(api.config, prompt, JSON.stringify(externalPayload)).tokens).toBeLessThan(personalLimit + 6000);
    expect(await generateBriefing(db, { ...api.config, dailyTokenLimit: personalLimit + 6000 })).toBe("no_personal");
    expect(api.requests).toHaveLength(1);
  });
  it.each([false, true])("distingue fontes incorretas de JSON inválido e preserva histórico: fontes=%s", async sourcesInvalid => {
    const { db } = rssFixture(), api = await briefingEndpoint(() => sourcesInvalid ? { ...valid, topics: [{ ...valid.topics[0], itemIds: ["inventado"] }] } : { topics: [] });
    await expect(generateBriefing(db, api.config)).rejects.toThrow(sourcesInvalid ? "A IA não citou corretamente as fontes do briefing duas vezes." : "A IA retornou JSON inválido para o briefing duas vezes.");
    expect(api.requests).toHaveLength(2); expect(db.select().from(briefings).all()).toEqual([]);
    expect(getSetting(db, "briefing_external_notice")).toBeUndefined();
  });
  it("perda de lease impede gravação do aviso externo em cache", async () => {
    const { db } = rssFixture(), api = await briefingEndpoint();
    await generateBriefing(db, api.config);
    await expect(generateBriefing(db, api.config, () => { throw new Error("lease perdido"); })).rejects.toThrow("lease perdido");
    expect(api.requests).toHaveLength(1);
  });
  it("retorna no_profile ou no_personal sem reservar nem chamar a rede", async () => {
    const db = openDatabase(":memory:"); databases.push(db);
    const config = getAIConfig({ AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "fixture", AI_MODEL: "fixture" })!;
    expect(await generateBriefing(db, config)).toBe("no_profile");
    db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run();
    expect(await generateBriefing(db, config)).toBe("no_personal");
    expect(dailyUsage(db).calls).toBe(0);
  });
  it("aviso do briefing nomeia a falta real", async () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-briefing-env-")); directories.push(directory);
    const file = join(directory, "orbit.env");
    writeFileSync(file, "AI_MODEL=classification-fixture\nAI_BRIEFING_MODEL=briefing-fixture\nAI_API_KEY=synthetic-key\n");
    vi.stubEnv("ORBIT_ENV_FILE", file);
    const db = openDatabase(":memory:"); databases.push(db);
    const run = db.insert(collectorRuns).values({ status: "running", startedAt: Date.now() }).returning().get();
    await runWithConfiguredAI(db, run.id);
    const notice = getSetting(db, "briefing_notice");
    expect(notice).toContain("AI_BASE_URL");
    expect(notice).not.toMatch(/^Configure AI_BRIEFING_MODEL/);
  });
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
    const requests: { dayUTC: string; items: { id: string; description: string }[] }[] = [];
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
    expect(await generateBriefing(db, config)).toBe("created");
    expect(await generateBriefing(db, config)).toBe("unchanged");
    expect(await generateBriefing(db, { ...config, dailyTokenLimit: 1 })).toBe("unchanged");
    expect(calls).toBe(1);
    expect(db.select().from(briefings).all()).toHaveLength(1);
    expect(db.select().from(topics).get()?.title).toBe("Ciência no seu feed");
    expect(db.select().from(processedItems).get()?.clusterId).toBeTruthy();
    expect(dailyUsage(db).tokens).toBe(200);
    expect(requests[0].dayUTC).toBe(new Date().toISOString().slice(0, 10));
    expect(requests[0].items[0].description).toBe("Descrição da aula");
    expect(requests[0].items.map(item => item.id)).toEqual(["youtube:item"]);

    // Nada mudou não depende do dia UTC; os itens continuam dentro da janela.
    const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(0, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(tomorrow);
    expect(await generateBriefing(db, config)).toBe("unchanged");
    expect(calls).toBe(1);
    vi.useRealTimers();

    db.update(rawItems).set({ title: "Aula atualizada" }).where(eq(rawItems.id, "youtube:item")).run();
    invalidResponses = 1;
    expect(await generateBriefing(db, config)).toBe("created");
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
    expect(await generateBriefing(db, { ...config, dailyTokenLimit: 15000 })).toBe("created");
    expect(db.select().from(briefings).orderBy(desc(briefings.id)).get()).toMatchObject({ sourceCount: 1, candidateCount: 2, budgetLimited: true });
    expect(await generateBriefing(db, config)).toBe("unchanged");
    expect(calls).toBe(6);
  });
});
