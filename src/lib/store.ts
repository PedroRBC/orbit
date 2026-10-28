import { and, eq, isNull, sql } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { aiCalls, collectorRuns, interestProfile, rawItems, settings, sources, sourceItems } from "../db/schema";
import type { RawItem } from "../collectors/youtube";

export function enqueueCollection(db: OrbitDB): number {
  return db.transaction(() => {
    const pending = db.select().from(collectorRuns).where(sql`${collectorRuns.parentId} IS NULL AND ${collectorRuns.kind} = 'collection' AND ${collectorRuns.status} IN ('queued', 'running')`).get();
    if (pending) return pending.id;
    return db.insert(collectorRuns).values({ status: "queued", startedAt: Date.now() }).returning().get().id;
  }, { behavior: "immediate" });
}

export function claimRun(db: OrbitDB, assertActive: () => void = () => {}) {
  return db.transaction(() => {
    assertActive();
    const run = db.select().from(collectorRuns).where(and(isNull(collectorRuns.parentId), eq(collectorRuns.status, "queued"))).get();
    if (!run) return;
    db.update(collectorRuns).set({ status: "running", startedAt: Date.now() }).where(eq(collectorRuns.id, run.id)).run();
    return run;
  }, { behavior: "immediate" });
}

export function saveRawItems(db: OrbitDB, sourceId: number, items: RawItem[]): number {
  return db.transaction(() => items.reduce((count, item) => {
    const id = `${item.platform}:${item.externalId}`;
    const inserted = db.insert(rawItems).values({ ...item, id, sourceId, fetchedAt: Date.now() }).onConflictDoNothing().run().changes;
    const existingId = inserted ? id : db.select({ id: rawItems.id }).from(rawItems).where(eq(rawItems.id, id)).get()?.id || db.select({ id: rawItems.id }).from(rawItems).where(and(eq(rawItems.url, item.url), eq(rawItems.platform, item.platform))).get()?.id;
    if (!existingId) throw new Error("Não foi possível localizar o item deduplicado.");
    // Revalidar publicação legada sem trocar conteúdo, data antiga ou a primeira publicação comprovada.
    if (!inserted && item.platform === "news" && item.evidence === "news_rss" && item.newsPublishedAt != null) db.update(rawItems).set({ newsPublishedAt: item.newsPublishedAt }).where(and(eq(rawItems.id, existingId), isNull(rawItems.newsPublishedAt))).run();
    db.insert(sourceItems).values({ sourceId, rawId: existingId }).onConflictDoNothing().run();
    return count + inserted;
  }, 0));
}

export function activeItemCondition() {
  return sql`exists (select 1 from ${sourceItems} join ${sources} on ${sources.id} = ${sourceItems.sourceId} where ${sourceItems.rawId} = ${rawItems.id} and ${sources.enabled} = 1)`;
}

export function getProfile(db: OrbitDB) {
  return db.select().from(interestProfile).where(eq(interestProfile.id, 1)).get();
}

export function dailyUsage(db: OrbitDB, day = new Date().toISOString().slice(0, 10)) {
  const rows = db.select().from(aiCalls).where(eq(aiCalls.day, day)).all();
  return { tokens: rows.reduce((n, row) => n + row.tokens, 0), cost: rows.length && rows.every(row => row.cost !== null) ? rows.reduce((n, row) => n + (row.cost ?? 0), 0) : null, reserved: rows.filter(row => row.status === "reserved").length, calls: rows.length };
}

export function reserveUsage(db: OrbitDB, tokens: number, cost: number | null, tokenLimit: number, costLimit: number | null): number {
  if (!Number.isSafeInteger(tokens) || tokens <= 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) throw new Error("Reserva inválida.");
  return db.transaction(() => {
    const day = new Date().toISOString().slice(0, 10);
    const usage = dailyUsage(db, day);
    if (usage.tokens + tokens > tokenLimit || (costLimit !== null && (cost === null || (usage.calls > 0 && usage.cost === null) || (usage.cost ?? 0) + cost > costLimit))) throw new Error("Limite diário de IA atingido. Teto preservado; tente no próximo dia UTC ou ajuste o .env.");
    return db.insert(aiCalls).values({ day, tokens, cost, status: "reserved", createdAt: Date.now() }).returning().get().id;
  }, { behavior: "immediate" });
}

export function settleUsage(db: OrbitDB, id: number, tokens: number, cost: number | null) {
  if (!Number.isSafeInteger(tokens) || tokens < 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) throw new Error("Uso inválido.");
  db.update(aiCalls).set({ tokens, cost, status: "settled" }).where(eq(aiCalls.id, id)).run();
}

export function setSetting(db: OrbitDB, key: string, value: string) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
export function getSetting(db: OrbitDB, key: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function acquireLease(db: OrbitDB, owner: string, now = Date.now()): boolean {
  return db.transaction(() => {
    const current = getSetting(db, "worker_lease");
    const lease = current ? JSON.parse(current) as { owner: string; expires: number } : null;
    if (lease && lease.owner !== owner && lease.expires > now) return false;
    setSetting(db, "worker_lease", JSON.stringify({ owner, expires: now + 60_000 }));
    setSetting(db, "worker_heartbeat", String(now));
    return true;
  }, { behavior: "immediate" });
}

export function workerOnline(db: OrbitDB, now = Date.now()) {
  return Number(getSetting(db, "worker_heartbeat") || 0) > now - 30_000;
}

export function assertLease(db: OrbitDB, owner: string) {
  const current = getSetting(db, "worker_lease");
  const lease = current ? JSON.parse(current) as { owner: string; expires: number } : null;
  if (!lease || lease.owner !== owner || lease.expires <= Date.now()) throw new Error("Propriedade do worker perdida.");
}

export function recoverRuns(db: OrbitDB, assertActive: () => void = () => {}) {
  db.transaction(() => {
    assertActive();
    db.update(collectorRuns).set({ status: "queued", error: "Execução retomada após reinício do worker." }).where(and(isNull(collectorRuns.parentId), eq(collectorRuns.status, "running"))).run();
    db.update(collectorRuns).set({ status: "error", finishedAt: Date.now(), error: "Coleta interrompida por reinício; será repetida sem duplicar itens." }).where(sql`${collectorRuns.parentId} IS NOT NULL AND ${collectorRuns.status} = 'running'`).run();
  }, { behavior: "immediate" });
}
