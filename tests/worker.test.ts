import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, interestProfile, sources, rawItems, processedItems } from "../src/db/schema";
import { acquireLease, claimRun, enqueueCollection, recoverRuns } from "../src/lib/store";
import { CollectorError } from "../src/collectors/errors";
import { runCollection, runWithConfiguredAI } from "../src/lib/run";

const databases: ReturnType<typeof openDatabase>[] = [];
function database() { const db = openDatabase(":memory:"); databases.push(db); return db; }
afterEach(() => { vi.unstubAllEnvs(); for (const db of databases.splice(0)) db.$client.close(); });

describe("worker", () => {
  it("isola falha de um canal e persiste o seguinte sem IA configurada", async () => {
    const db = database();
    db.insert(sources).values([{ channelId: "first", name: "Primeiro" }, { channelId: "second", name: "Segundo" }]).run();
    const id = enqueueCollection(db);
    claimRun(db);
    await runCollection(db, id, { collect: async channel => { if (channel === "first") throw new Error("Falha externa"); return [{ platform: "youtube", externalId: "abcdefghijk", title: "Aula", text: "Ciência", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: null, durationSeconds: null }]; }, config: null });
    expect(db.select().from(rawItems).all()).toHaveLength(1);
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, id)).get()?.status).toBe("partial");
    expect(db.select().from(processedItems).all()).toHaveLength(0);
  });
  it("registra verificação por plataforma e continua o RSS seguinte", async () => {
    const db = database();
    db.insert(sources).values([{ channelId: "https://x.com/home", name: "X", kind: "x_for_you", platform: "x" }, { channelId: "rss", name: "Canal RSS" }]).run();
    const id = enqueueCollection(db); claimRun(db);
    await runCollection(db, id, { config: null, collect: async channel => { if (channel === "https://x.com/home") throw new CollectorError("verification_required", "Verificação manual necessária."); return []; } });
    const runs = db.select().from(collectorRuns).all();
    expect(runs.filter(run => run.status === "verification_required")).toHaveLength(1);
    expect(runs.filter(run => run.parentId === id && run.status === "completed")).toHaveLength(1);
  });
  it("não repete uma fonte enquanto Retry-After estiver ativo", async () => {
    const db = database();
    db.insert(sources).values({ channelId: "limited", name: "Fonte limitada" }).run();
    let calls = 0;
    const dependencies = { config: null, collect: async () => { calls++; throw new CollectorError("rate_limited", "Aguarde.", 60000); } };
    const first = enqueueCollection(db); claimRun(db); await runCollection(db, first, dependencies);
    const second = enqueueCollection(db); claimRun(db); await runCollection(db, second, dependencies);
    expect(calls).toBe(1);
    expect(db.select().from(sources).get()?.cooldownUntil).toBeGreaterThan(Date.now());
  });
  it("impede dois workers ativos e recupera trabalho após expirar o lease", () => {
    const db = database();
    expect(acquireLease(db, "one", 1000)).toBe(true);
    expect(acquireLease(db, "two", 2000)).toBe(false);
    expect(acquireLease(db, "two", 62000)).toBe(true);
    const id = enqueueCollection(db);
    claimRun(db);
    recoverRuns(db);
    expect(claimRun(db)?.id).toBe(id);
  });
  it("não persiste coleta nem conclui job depois de perder a propriedade", async () => {
    const db = database();
    db.insert(sources).values({ channelId: "one", name: "Canal" }).run();
    const id = enqueueCollection(db); claimRun(db);
    let lost = false;
    const assertActive = () => { if (lost) throw new Error("Lease perdido"); };
    await expect(runCollection(db, id, { config: null, assertActive, collect: async () => { lost = true; return []; } })).rejects.toThrow("Lease perdido");
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, id)).get()?.status).toBe("running");
  });
  it("continua RSS se a configuração de IA estiver inválida", async () => {
    vi.stubEnv("AI_BASE_URL", "https://example.com"); vi.stubEnv("AI_API_KEY", "test-key"); vi.stubEnv("AI_MODEL", "custom"); vi.stubEnv("AI_DAILY_TOKEN_LIMIT", "0");
    const db = database();
    db.insert(sources).values({ channelId: "one", name: "Canal" }).run();
    const id = enqueueCollection(db); claimRun(db);
    await runWithConfiguredAI(db, id, async () => [{ platform: "youtube", externalId: "abcdefghijk", title: "Aula", text: "Ciência", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: null, durationSeconds: null }]);
    expect(db.select().from(rawItems).all()).toHaveLength(1);
  });
  it("não classifica antes de existir um perfil de interesses", async () => {
    const db = database();
    const id = enqueueCollection(db);
    claimRun(db);
    await runCollection(db, id, { config: null });
    expect(db.select().from(interestProfile).all()).toEqual([]);
  });
});
