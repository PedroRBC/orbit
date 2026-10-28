import { eq } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { collectorRuns, editions } from "../db/schema";
import { assertLease, getSetting } from "./store";

export type EditionSchedule = { enabled: boolean; timezone: string; needsTimezone: boolean; error: string | null };
export function readEditionSchedule(db: OrbitDB, env: Record<string, string | undefined> = process.env): EditionSchedule {
  try {
    const stored = getSetting(db, "edition_schedule");
    const collection = getSetting(db, "scheduler_config");
    const inherited = collection ? JSON.parse(collection).timezone : env.COLLECTOR_TIMEZONE;
    const config = stored ? JSON.parse(stored) : { enabled: !!inherited, timezone: inherited || "America/Sao_Paulo" };
    if (typeof config.enabled !== "boolean" || typeof config.timezone !== "string" || config.timezone.length > 100) throw new Error("Agenda inválida");
    new Intl.DateTimeFormat("pt-BR", { timeZone: config.timezone });
    return { enabled: config.enabled, timezone: config.timezone, needsTimezone: !stored && !inherited, error: null };
  } catch {
    return { enabled: false, timezone: "America/Sao_Paulo", needsTimezone: true, error: "Confira o fuso da agenda geral. Nenhuma edição automática será gerada até corrigir a configuração." };
  }
}

export function dueEditionSlot(now: Date, timezone: string) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (time: number) => Object.fromEntries(format.formatToParts(time).map(part => [part.type, part.value]));
  const end = Math.floor(now.getTime() / 60000) * 60000;
  // Procura somente duas horas: reinício não recupera um backlog de edições antigas.
  for (let delay = 0; delay <= 120; delay++) {
    const scheduledAt = end - delay * 60000;
    const local = parts(scheduledAt);
    if (local.minute !== "00" || !["08", "16"].includes(local.hour)) continue;
    const localDate = `${local.year}-${local.month}-${local.day}`;
    const morning = local.hour === "08";
    return { slot: `${timezone}:${localDate}:${local.hour}`, localDate, edition: morning ? "morning" as const : "afternoon" as const, timezone, scheduledAt, windowFrom: scheduledAt - (morning ? 24 : 8) * 3600000, windowTo: scheduledAt };
  }
  return null;
}

export function queueDueEdition(db: OrbitDB, owner: string, now = new Date()): number | null {
  return db.transaction(() => {
    assertLease(db, owner);
    const schedule = readEditionSchedule(db);
    if (!schedule.enabled || schedule.error) return null;
    const slot = dueEditionSlot(now, schedule.timezone);
    if (!slot || db.select().from(editions).where(eq(editions.slot, slot.slot)).get()) return null;
    const edition = db.insert(editions).values({ ...slot, createdAt: now.getTime() }).returning().get();
    db.insert(collectorRuns).values({ kind: "edition", editionId: edition.id, trigger: "scheduled", status: "queued", startedAt: now.getTime() }).run();
    return edition.id;
  }, { behavior: "immediate" });
}

export const editionLabel = (edition: string) => edition === "morning" ? "Edição da manhã" : "Edição da tarde";
export function editionTime(time: number, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(time);
}
