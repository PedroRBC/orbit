import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, editions, sources } from "../src/db/schema";
import { acquireLease, claimRun, enqueueCollection, recoverRuns, setSetting } from "../src/lib/store";
import { dueEditionSlot, queueDueEdition, readEditionSchedule } from "../src/lib/editions";
import { queueScheduledRun } from "../src/lib/scheduler";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of databases.splice(0)) db.$client.close(); });
function setup(at = "2026-10-28T11:00:00Z") {
  vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  const db = openDatabase(":memory:"); databases.push(db); acquireLease(db, "owner");
  setSetting(db, "edition_schedule", JSON.stringify({ enabled: true, timezone: "America/Sao_Paulo" }));
  return db;
}

describe("agenda das edições gerais", () => {
  it("propõe São Paulo sem ativar silenciosamente um fuso ausente", () => {
    const db = openDatabase(":memory:"); databases.push(db);
    expect(readEditionSchedule(db, {})).toMatchObject({ enabled: false, timezone: "America/Sao_Paulo", needsTimezone: true });
    expect(readEditionSchedule(db, { COLLECTOR_TIMEZONE: "UTC" })).toMatchObject({ enabled: true, timezone: "UTC", needsTimezone: false });
    setSetting(db, "scheduler_config", JSON.stringify({ enabled: false, expression: "0 12 * * *", timezone: "Europe/Lisbon" }));
    expect(readEditionSchedule(db, {})).toMatchObject({ enabled: true, timezone: "Europe/Lisbon" });
    setSetting(db, "edition_schedule", JSON.stringify({ enabled: true, timezone: "invalid" }));
    expect(readEditionSchedule(db, {}).enabled).toBe(false);
  });
  it("calcula 08h e 16h no fuso, sem executar antes nem recuperar dias perdidos", () => {
    expect(dueEditionSlot(new Date("2026-10-28T10:59:59Z"), "America/Sao_Paulo")).toBeNull();
    expect(dueEditionSlot(new Date("2026-10-28T11:25:00Z"), "America/Sao_Paulo")).toMatchObject({ localDate: "2026-10-28", edition: "morning", scheduledAt: Date.parse("2026-10-28T11:00Z") });
    expect(dueEditionSlot(new Date("2026-10-28T19:00:00Z"), "America/Sao_Paulo")).toMatchObject({ edition: "afternoon", windowFrom: Date.parse("2026-10-28T11:00Z") });
    expect(dueEditionSlot(new Date("2026-10-29T03:00:00Z"), "America/Sao_Paulo")).toBeNull();
    expect(dueEditionSlot(new Date("2026-10-28T13:01:00Z"), "America/Sao_Paulo")).toBeNull();
  });
  it("ajusta a hora UTC ao horário de verão sem mudar a chave local", () => {
    const summer = dueEditionSlot(new Date("2026-10-31T12:00Z"), "America/New_York");
    const winter = dueEditionSlot(new Date("2026-11-01T13:00Z"), "America/New_York");
    expect(summer?.slot).toBe("America/New_York:2026-10-31:08");
    expect(winter?.slot).toBe("America/New_York:2026-11-01:08");
    expect(winter!.scheduledAt - summer!.scheduledAt).toBe(25 * 3600000);
  });
  it("persiste somente uma fila por edição, mesmo sem fontes e após reinício", () => {
    const db = setup();
    const id = queueDueEdition(db, "owner");
    expect(id).toBeTypeOf("number");
    expect(queueDueEdition(db, "owner")).toBeNull();
    expect(db.select().from(editions).all()).toHaveLength(1);
    expect(claimRun(db)).toMatchObject({ kind: "edition", editionId: id });
    recoverRuns(db);
    expect(queueDueEdition(db, "owner")).toBeNull();
    expect(db.select().from(collectorRuns).all()).toHaveLength(1);
  });
  it("atualização pessoal não reutiliza a execução de uma edição geral", () => {
    const db = setup();
    queueDueEdition(db, "owner");
    const personalId = enqueueCollection(db);
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.id, personalId)).get()?.kind).toBe("collection");
    expect(enqueueCollection(db)).toBe(personalId);
  });
  it("edições gerais não consomem o limite nem cancelam a coleta pessoal no mesmo horário", () => {
    const db = setup();
    db.insert(sources).values({ name: "Canal sintético", channelId: "fixture" }).run();
    for (let index = 0; index < 6; index++) db.insert(collectorRuns).values({ kind: "edition", status: "completed", trigger: "scheduled", startedAt: Date.now() - index * 1000, finishedAt: Date.now() }).run();
    queueDueEdition(db, "owner");
    expect(queueScheduledRun(db, "owner")).toBeTypeOf("number");
  });
  it("uma edição pode aguardar coleta pessoal; lease e pausa continuam obrigatórios", () => {
    const db = setup();
    db.insert(sources).values({ name: "Fixture", channelId: "fixture" }).run();
    db.insert(collectorRuns).values({ status: "running", startedAt: Date.now() }).run();
    expect(queueDueEdition(db, "owner")).toBeTypeOf("number");
    expect(() => queueDueEdition(db, "stranger")).toThrow();
    setSetting(db, "edition_schedule", JSON.stringify({ enabled: false, timezone: "America/Sao_Paulo" }));
    expect(queueDueEdition(db, "owner")).toBeNull();
    expect(db.select().from(collectorRuns).where(eq(collectorRuns.kind, "edition")).all()).toHaveLength(1);
  });
});
