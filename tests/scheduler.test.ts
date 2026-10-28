import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, sources } from "../src/db/schema";
import { acquireLease, claimRun, setSetting } from "../src/lib/store";
import { readSchedule, queueScheduledRun } from "../src/lib/scheduler";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of databases.splice(0)) db.$client.close(); });
function setup() { const db = openDatabase(":memory:"); databases.push(db); acquireLease(db, "owner"); db.insert(sources).values({ channelId: "channel", name: "Canal" }).run(); return db; }

describe("agendamento local", () => {
  it("padrão executa três vezes ao dia no fuso informado", () => {
    const db = setup();
    expect(readSchedule(db, {})).toMatchObject({ enabled: true, expression: "0 8,14,20 * * *" });
    expect(readSchedule(db, { COLLECTOR_TIMEZONE: "America/Sao_Paulo" }).timezone).toBe("America/Sao_Paulo");
    expect(readSchedule(db, { COLLECTOR_CRON: "invalid" }).error).toBeTruthy();
  });
  it("enfileira cada horário uma vez e evita sobrepor execução ativa", () => {
    const db = setup();
    const now = new Date("2026-10-28T11:00:00Z");
    expect(queueScheduledRun(db, "owner", now)).toBeTypeOf("number");
    expect(queueScheduledRun(db, "owner", now)).toBeNull();
    claimRun(db);
    expect(queueScheduledRun(db, "owner", new Date("2026-10-28T17:00:00Z"))).toBeNull();
  });
  it("não duplica um horário repetido pelo fim do horário de verão", () => {
    const db = setup();
    setSetting(db, "scheduler_config", JSON.stringify({ enabled: true, expression: "30 1 * * *", timezone: "America/New_York" }));
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T05:30:00Z")); acquireLease(db, "owner");
    const first = queueScheduledRun(db, "owner");
    db.update(collectorRuns).set({ status: "completed", finishedAt: Date.now() }).where(eq(collectorRuns.id, first!)).run();
    vi.setSystemTime(new Date("2026-11-01T06:30:00Z")); acquireLease(db, "owner");
    expect(queueScheduledRun(db, "owner")).toBeNull();
  });
  it("limita automação a seis execuções em 24 horas", () => {
    const db = setup(); vi.useFakeTimers();
    for (let index = 0; index < 8; index++) {
      vi.setSystemTime(new Date(`2026-11-02T${String(index + 1).padStart(2, "0")}:00:00Z`)); acquireLease(db, "owner");
      const id = queueScheduledRun(db, "owner");
      if (id) db.update(collectorRuns).set({ status: "completed", finishedAt: Date.now() }).where(eq(collectorRuns.id, id)).run();
    }
    expect(db.select().from(collectorRuns).all()).toHaveLength(6);
  });
  it("não executa desativado nem sem o lease correto", () => {
    const db = setup();
    setSetting(db, "scheduler_enabled", "false");
    expect(queueScheduledRun(db, "owner")).toBeNull();
    setSetting(db, "scheduler_enabled", "true");
    expect(() => queueScheduledRun(db, "different-owner")).toThrow();
    db.update(sources).set({ enabled: false }).run();
    expect(queueScheduledRun(db, "owner")).toBeNull();
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.status, "queued")).all()).toEqual([]);
  });
});
