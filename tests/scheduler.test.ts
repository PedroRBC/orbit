import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, sources } from "../src/db/schema";
import { acquireLease, claimRun, setSetting } from "../src/lib/store";
import { readSchedule, queueScheduledRun } from "../src/lib/scheduler";
import { readEditionSchedule } from "../src/lib/editions";
import { readEnvironment } from "../src/lib/ai-environment";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databases: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); for (const db of databases.splice(0)) db.$client.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("SCHEDULER_ENABLED inválido cita a variável", () => {
  expect(readSchedule(setup(), { SCHEDULER_ENABLED: "sim" })).toMatchObject({ enabled: false, error: expect.stringContaining("SCHEDULER_ENABLED") });
});
it("COLLECTOR_MAX_RUNS_PER_DAY inválido cita a variável", () => {
  expect(readSchedule(setup(), { COLLECTOR_MAX_RUNS_PER_DAY: "99" }).error).toContain("COLLECTOR_MAX_RUNS_PER_DAY");
});
it("origem da agenda", () => {
  const db = setup();
  expect(readSchedule(db, {}).origin).toBe("padrão");
  expect(readSchedule(db, { COLLECTOR_CRON: "0 12 * * *" }).origin).toBe("ambiente");
  setSetting(db, "scheduler_config", JSON.stringify({ enabled: true, expression: "0 14 * * *", timezone: "UTC" }));
  expect(readSchedule(db, {}).origin).toBe("interface");
});
it("agendas preservam origem do leitor e respeitam o env explícito", () => {
  const path = mkdtempSync(join(tmpdir(), "orbit-schedule-env-")); directories.push(path);
  const file = join(path, "orbit.env"); writeFileSync(file, "COLLECTOR_CRON=0 12 * * *\nCOLLECTOR_TIMEZONE=Europe/Lisbon\nSCHEDULER_ENABLED=false\n");
  vi.stubEnv("ORBIT_ENV_FILE", file);
  const db = setup(), env = readEnvironment().env;
  expect(readSchedule(db)).toMatchObject({ origin: "arquivo", enabled: false, timezone: "Europe/Lisbon" });
  expect(readSchedule(db, env).origin).toBe("arquivo");
  expect(readSchedule(db, { COLLECTOR_TIMEZONE: "UTC" })).toMatchObject({ origin: "ambiente", timezone: "UTC", enabled: true });
  expect(readSchedule(db, {}).origin).toBe("padrão");
  expect(readEditionSchedule(db, env)).toMatchObject({ origin: "arquivo", timezone: "Europe/Lisbon" });
  expect(readEditionSchedule(db, { COLLECTOR_TIMEZONE: "UTC" })).toMatchObject({ origin: "ambiente", timezone: "UTC" });
  expect(readEditionSchedule(db, {})).toMatchObject({ origin: "padrão", enabled: false });
  setSetting(db, "scheduler_config", JSON.stringify({ enabled: true, expression: "0 14 * * *", timezone: "UTC" }));
  expect(readEditionSchedule(db, {}).origin).toBe("coleta");
  setSetting(db, "edition_schedule", JSON.stringify({ enabled: true, timezone: "UTC" }));
  expect(readEditionSchedule(db, {}).origin).toBe("interface");
});
it("fila agendada usa o env explícito", () => {
  expect(queueScheduledRun(setup(), "owner", new Date(), { SCHEDULER_ENABLED: "false" })).toBeNull();
});
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
