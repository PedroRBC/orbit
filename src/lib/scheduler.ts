import cron from "node-cron";
import { z } from "zod";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { collectorRuns, sources } from "../db/schema";
import { assertLease, enqueueCollection, getSetting, setSetting } from "./store";
import { environmentSource, readEnvironment } from "./ai-environment";

export type ScheduleConfig = { enabled: boolean; expression: string; timezone: string; maxRuns: number; error: string | null; origin: "interface" | "arquivo" | "ambiente" | "padrão" };
export function validSchedule(expression: string, timezone: string) {
  if (expression.length > 120 || !cron.validate(expression)) throw new Error("Expressão cron inválida.");
  new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
}
export function readSchedule(db: OrbitDB, env: Record<string, string | undefined> = readEnvironment().env): ScheduleConfig {
  const fallback = { enabled: env.SCHEDULER_ENABLED !== "false", expression: env.COLLECTOR_CRON || "0 8,14,20 * * *", timezone: env.COLLECTOR_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone };
  const stored = getSetting(db, "scheduler_config"), enabled = getSetting(db, "scheduler_enabled");
  const keys = ["COLLECTOR_CRON", "COLLECTOR_TIMEZONE", "SCHEDULER_ENABLED", "COLLECTOR_MAX_RUNS_PER_DAY"];
  const origin: ScheduleConfig["origin"] = stored || enabled !== undefined ? "interface" : keys.some(key => environmentSource(env, key) === "arquivo") ? "arquivo" : keys.some(key => environmentSource(env, key) === "ambiente") ? "ambiente" : "padrão";
  const invalid = (error: string): ScheduleConfig => ({ ...fallback, origin, maxRuns: 6, enabled: false, error });
  if (env.SCHEDULER_ENABLED && !["true", "false"].includes(env.SCHEDULER_ENABLED)) return invalid("SCHEDULER_ENABLED inválido: use true ou false. Coleta manual continua disponível.");
  const maxRuns = z.coerce.number().int().min(1).max(12).safeParse(env.COLLECTOR_MAX_RUNS_PER_DAY || "6");
  if (!maxRuns.success) return invalid("COLLECTOR_MAX_RUNS_PER_DAY inválido: use inteiro entre 1 e 12. Coleta manual continua disponível.");
  try {
    const config = stored ? JSON.parse(stored) as typeof fallback : fallback;
    if (typeof config.enabled !== "boolean" || typeof config.expression !== "string" || typeof config.timezone !== "string") throw new Error("Configuração inválida.");
    validSchedule(config.expression, config.timezone);
    return { ...config, origin, maxRuns: maxRuns.data, enabled: enabled === undefined ? config.enabled : enabled === "true", error: null };
  } catch { return invalid("Agendamento inválido. Corrija os horários/fuso; coleta manual continua disponível."); }
}
export function queueScheduledRun(db: OrbitDB, owner: string, now = new Date(), env: Record<string, string | undefined> = readEnvironment().env): number | null {
  return db.transaction(() => {
    const config = readSchedule(db, env);
    if (!config.enabled || config.error) return null;
    assertLease(db, owner);
    if (!db.select().from(sources).where(eq(sources.enabled, true)).get()) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(part => [part.type, part.value]));
    const slot = `${config.timezone}:${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    const slots = Object.fromEntries(Object.entries(JSON.parse(getSetting(db, "scheduler_slots") || "{}") as Record<string, number>).filter(([, value]) => value > now.getTime() - 48 * 3600000));
    if (Object.hasOwn(slots, slot)) return null;
    const recent = db.select({ count: sql<number>`count(*)` }).from(collectorRuns).where(and(isNull(collectorRuns.parentId), eq(collectorRuns.kind, "collection"), eq(collectorRuns.trigger, "scheduled"), gte(collectorRuns.startedAt, now.getTime() - 24 * 3600000))).get()?.count || 0;
    if (recent >= config.maxRuns) return null;
    if (db.select().from(collectorRuns).where(sql`${collectorRuns.parentId} IS NULL AND ${collectorRuns.kind} = 'collection' AND ${collectorRuns.status} IN ('queued','running')`).get()) return null;
    const last = db.select().from(collectorRuns).where(and(isNull(collectorRuns.parentId), eq(collectorRuns.kind, "collection"))).orderBy(desc(collectorRuns.id)).get();
    if (last?.finishedAt && now.getTime() - last.finishedAt < 300000) return null;
    const id = enqueueCollection(db);
    setSetting(db, "scheduler_slots", JSON.stringify({ ...slots, [slot]: now.getTime() }));
    setSetting(db, "scheduler_last_slot", slot);
    db.update(collectorRuns).set({ trigger: "scheduled" }).where(eq(collectorRuns.id, id)).run();
    return id;
  }, { behavior: "immediate" });
}
