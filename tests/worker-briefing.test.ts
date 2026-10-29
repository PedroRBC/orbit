import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { aiCalls, briefings, collectorRuns, editions, interestProfile, processedItems, sources } from "../src/db/schema";
import { acquireLease, assertLease, getSetting, saveRawItems } from "../src/lib/store";
import { runWithConfiguredAI } from "../src/lib/run";

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of databases.splice(0)) db.$client.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
function setup() {
  const db = openDatabase(":memory:"); databases.push(db);
  const run = db.insert(collectorRuns).values({ kind: "briefing", status: "running", startedAt: Date.now() }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run();
  const source = db.insert(sources).values({ channelId: "synthetic-no-collection", name: "Fonte sintética" }).returning().get();
  saveRawItems(db, source.id, [{ externalId: "fixture", platform: "youtube", title: "Aula sintética", text: "Ciência", author: "Teste", url: "https://www.youtube.com/watch?v=fixture", thumbnail: null, publishedAt: null, durationSeconds: null }]);
  for (const [key, value] of Object.entries({ AI_BASE_URL: "", AI_API_KEY: "fixture", AI_MODEL: "classification", AI_BRIEFING_MODEL: "", AI_PROTOCOL: "openai", AI_DAILY_TOKEN_LIMIT: "50000", AI_DAILY_USD_LIMIT: "" })) vi.stubEnv(key, value);
  return { db, run };
}
async function endpoint(onRequest: (classification: boolean) => void = () => {}, invalidSources = false) {
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body), payload = JSON.parse(request.messages[1].content);
    const classification = request.model === "classification";
    const result = classification ? { items: payload.items.map((item: { id: string }) => ({ id: item.id, theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Teste", summary: "Resumo sintético", isSpam: false })) } : { introduction: "Recorte sintético do feed.", topics: [{ title: "Ciência", summary: "Resumo baseado no item de teste.", itemIds: invalidSources ? ["id-sintetico-incorreto"] : payload.items.map((item: { id: string }) => item.id) }] };
    onRequest(classification);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "local", object: "chat.completion", model: request.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta");
  vi.stubEnv("AI_BASE_URL", `http://127.0.0.1:${address.port}/v1`); vi.stubEnv("AI_BRIEFING_MODEL", "briefing");
}
it("briefing sem modelo recusa antes de classificar ou coletar e preserva o motivo", async () => {
  const { db, run } = setup();
  const collect = vi.fn(async () => []);
  await runWithConfiguredAI(db, run.id, collect);
  expect(db.select().from(collectorRuns).get()).toMatchObject({ status: "error", error: "Configure AI_BRIEFING_MODEL para gerar briefings." });
  expect(getSetting(db, "briefing_notice")).toBe("Configure AI_BRIEFING_MODEL para gerar briefings.");
  expect(db.select().from(aiCalls).all()).toEqual([]);
  expect(collect).not.toHaveBeenCalled();
});
it("classifica pendências e gera sem fontes; cache completa com Nada mudou e sem nova reserva", async () => {
  const { db, run } = setup(); let calls = 0;
  await endpoint(() => { calls++; });
  const collect = vi.fn(async () => []);
  await runWithConfiguredAI(db, run.id, collect);
  expect(db.select().from(processedItems).all()).toHaveLength(1);
  expect(db.select().from(briefings).all()).toHaveLength(1);
  expect(db.select().from(collectorRuns).all()).toMatchObject([{ id: run.id, status: "completed" }]);
  expect(getSetting(db, "briefing_notice")).toBe("");
  await runWithConfiguredAI(db, run.id, collect);
  expect(db.select().from(collectorRuns).get()?.status).toBe("completed");
  expect(getSetting(db, "briefing_notice")).toBe("Nada mudou desde o último briefing; nenhuma nova chamada de IA para gerar o briefing foi feita.");
  expect(calls).toBe(2);
  expect(db.select().from(aiCalls).all()).toHaveLength(2);
  expect(collect).not.toHaveBeenCalled();
});
it("cache não promete ausência de IA quando classifica uma pendência fora do recorte", async () => {
  const { db, run } = setup(); let classificationCalls = 0, briefingCalls = 0;
  await endpoint(classification => { if (classification) classificationCalls++; else briefingCalls++; });
  const source = db.select().from(sources).get()!;
  for (let i = 0; i < 8; i++) {
    const externalId = i === 0 ? "fixture" : `top-${i}`;
    if (i) saveRawItems(db, source.id, [{ externalId, platform: "youtube", title: "Aula sintética", text: "Ciência", author: "Teste", url: `https://www.youtube.com/watch?v=${externalId}`, thumbnail: null, publishedAt: null, durationSeconds: null }]);
    db.insert(processedItems).values({ rawId: `youtube:${externalId}`, theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 100, reason: "Teste", summary: "Resumo sintético", isSpam: false, model: "classification", processedAt: 1 }).run();
  }
  await runWithConfiguredAI(db, run.id);
  saveRawItems(db, source.id, [{ externalId: "low-ranked", platform: "youtube", title: "Outra aula sintética", text: "Ciência", author: "Teste", url: "https://www.youtube.com/watch?v=low-ranked", thumbnail: null, publishedAt: null, durationSeconds: null }]);
  await runWithConfiguredAI(db, run.id);
  expect(classificationCalls).toBe(1);
  expect(briefingCalls).toBe(1);
  expect(db.select().from(processedItems).all()).toHaveLength(9);
  expect(db.select().from(aiCalls).all()).toHaveLength(2);
  expect(db.select().from(briefings).all()).toHaveLength(1);
  expect(getSetting(db, "briefing_notice")).toBe("Nada mudou desde o último briefing; nenhuma nova chamada de IA para gerar o briefing foi feita.");
});
it("worker preserva o motivo seguro de fontes incorretas em vez de erro genérico", async () => {
  const { db, run } = setup();
  await endpoint(() => {}, true);
  await runWithConfiguredAI(db, run.id);
  expect(getSetting(db, "briefing_notice")).toBe("A IA não citou corretamente as fontes do briefing duas vezes. O briefing anterior foi preservado.");
  expect(db.select().from(collectorRuns).get()?.status).toBe("partial");
  expect(db.select().from(briefings).all()).toEqual([]);
});
it("lease perdido durante a rede não grava análise, briefing nem finalização; mantém reserva anterior", async () => {
  const { db, run } = setup(); acquireLease(db, "owner");
  await endpoint(() => { acquireLease(db, "other", Date.now() + 61000); });
  await expect(runWithConfiguredAI(db, run.id, undefined, { assertActive: () => assertLease(db, "owner") })).rejects.toThrow("Propriedade do worker perdida");
  expect(db.select().from(processedItems).all()).toEqual([]);
  expect(db.select().from(briefings).all()).toEqual([]);
  expect(db.select().from(collectorRuns).get()?.status).toBe("running");
  expect(getSetting(db, "briefing_notice")).toBeUndefined();
  expect(db.select().from(aiCalls).all()).toMatchObject([{ status: "reserved" }]);
});
it("lease perdido ao gerar briefing não publica nem liquida a reserva ambígua", async () => {
  const { db, run } = setup(); acquireLease(db, "owner");
  db.insert(processedItems).values({ rawId: "youtube:fixture", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Teste", summary: "Resumo sintético", isSpam: false, model: "fixture", processedAt: 1 }).run();
  await endpoint(() => { acquireLease(db, "other", Date.now() + 61000); });
  await expect(runWithConfiguredAI(db, run.id, undefined, { assertActive: () => assertLease(db, "owner") })).rejects.toThrow("Propriedade do worker perdida");
  expect(db.select().from(briefings).all()).toEqual([]);
  expect(db.select().from(collectorRuns).get()?.status).toBe("running");
  expect(getSetting(db, "briefing_notice")).toBeUndefined();
  expect(db.select().from(aiCalls).all()).toMatchObject([{ status: "reserved" }]);
});
it.each([false, true])("avisa ausência de perfil/itens sem rede (perfil=%s)", async withProfile => {
  const { db, run } = setup();
  if (withProfile) db.update(sources).set({ enabled: false }).run();
  else db.delete(interestProfile).run();
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1/v1"); vi.stubEnv("AI_BRIEFING_MODEL", "briefing");
  await runWithConfiguredAI(db, run.id);
  expect(db.select().from(collectorRuns).get()?.status).toBe("completed");
  expect(getSetting(db, "briefing_notice")).toBe(withProfile ? "Nenhum item pessoal disponível para este briefing. Consulte os briefings gerais ou Fora da bolha." : "Configure seus interesses para gerar o briefing pessoal.");
  expect(db.select().from(aiCalls).all()).toEqual([]);
});
it("worker finaliza edição running após exceção inesperada com lease válido", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-manual-worker-"));
  const path = join(directory, "orbit.db"), db = openDatabase(path), now = Date.now();
  db.insert(sources).values({ channelId: "https://synthetic.invalid/rss", name: "RSS sintético", platform: "news", kind: "news_rss" }).run();
  const edition = db.insert(editions).values({ edition: "manual", slot: `manual:UTC:${now}`, localDate: "2026-10-28", timezone: "UTC", scheduledAt: now, windowFrom: now - 86400000, windowTo: now, createdAt: now }).returning().get();
  const run = db.insert(collectorRuns).values({ kind: "edition", editionId: edition.id, status: "queued", startedAt: now }).returning().get();
  db.$client.exec("CREATE TRIGGER synthetic_child_failure BEFORE INSERT ON collector_runs WHEN NEW.parentId IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic private detail'); END");
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], { stdio: "ignore", env: { ...process.env, ORBIT_ENV_FILE: "", DOTENV_CONFIG_PATH: join(directory, "unused.env"), ORBIT_DB_PATH: path, SCHEDULER_ENABLED: "false", AI_BASE_URL: "", AI_API_KEY: "", AI_MODEL: "", AI_BRIEFING_MODEL: "", ORBIT_PUSH_SUBJECT: "" } });
  try {
    await expect.poll(() => db.select().from(collectorRuns).where(eq(collectorRuns.id, run.id)).get()?.status, { timeout: 5000 }).toBe("error");
    const final = db.select().from(editions).get()!;
    expect(final).toMatchObject({ status: "error", attempts: 1, notice: db.select().from(collectorRuns).where(eq(collectorRuns.id, run.id)).get()?.error });
    expect(final.notice).not.toContain("synthetic private detail");
    expect(child.exitCode).toBeNull();
  } finally {
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.once("error", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
    });
    db.$client.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
