import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, editions, sources } from "../src/db/schema";
import { acquireLease, claimRun, enqueueCollection, recoverRuns, setSetting } from "../src/lib/store";
import { dueEditionSlot, editionLabel, queueDueEdition, queueManualEdition, readEditionSchedule } from "../src/lib/editions";
import { queueScheduledRun } from "../src/lib/scheduler";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); for (const db of databases.splice(0)) db.$client.close(); });
function setup(at = "2026-10-28T11:00:00Z") {
  vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  const db = openDatabase(":memory:"); databases.push(db); acquireLease(db, "owner");
  setSetting(db, "edition_schedule", JSON.stringify({ enabled: true, timezone: "America/Sao_Paulo" }));
  return db;
}

describe("agenda das edições gerais", () => {
  it("manual exige fuso confirmado, inclusive quando a agenda automática está pausada", () => {
    const db = openDatabase(":memory:"); databases.push(db);
    vi.stubEnv("COLLECTOR_TIMEZONE", "");
    expect(queueManualEdition(db)).toBe("timezone");
    setSetting(db, "edition_schedule", JSON.stringify({ enabled: false, timezone: "invalid" }));
    expect(queueManualEdition(db)).toBe("timezone");
    expect(db.select().from(editions).all()).toEqual([]);
    setSetting(db, "edition_schedule", JSON.stringify({ enabled: false, timezone: "America/Sao_Paulo" }));
    const now = new Date("2026-10-29T01:00:00Z");
    expect(queueManualEdition(db, now)).toBe("queued");
    expect(db.select().from(editions).get()).toMatchObject({ edition: "manual", slot: `manual:America/Sao_Paulo:${now.getTime()}`, localDate: "2026-10-28", windowFrom: now.getTime() - 86400000, windowTo: now.getTime(), scheduledAt: now.getTime() });
    expect(db.select().from(collectorRuns).get()).toMatchObject({ kind: "edition", trigger: "manual", status: "queued" });
    expect(editionLabel("manual")).toBe("Edição sob demanda");
  });
  it("manual não sobrepõe edições pendentes e limita apenas pedidos manuais recentes", () => {
    const db = setup(), now = Date.now();
    const scheduled = queueDueEdition(db, "owner");
    expect(queueManualEdition(db)).toBe("active");
    db.update(collectorRuns).set({ status: "completed", finishedAt: now }).run();
    db.update(editions).set({ status: "published" }).where(eq(editions.id, scheduled!)).run();
    expect(queueManualEdition(db)).toBe("queued");
    db.update(collectorRuns).set({ status: "running" }).where(eq(collectorRuns.trigger, "manual")).run();
    expect(queueManualEdition(db)).toBe("active");
    db.update(collectorRuns).set({ status: "error", finishedAt: now }).where(eq(collectorRuns.trigger, "manual")).run();
    db.update(editions).set({ status: "error" }).where(eq(editions.edition, "manual")).run();
    expect(queueManualEdition(db, new Date(now + 299999))).toBe("recent");
    expect(queueManualEdition(db, new Date(now + 300000))).toBe("queued");
  });
  it("fila manual usa IMMEDIATE e reverte a edição quando a inserção do job falha", () => {
    const db = setup(), transaction = vi.spyOn(db, "transaction");
    db.$client.exec("CREATE TRIGGER synthetic_queue_failure BEFORE INSERT ON collector_runs BEGIN SELECT RAISE(ABORT, 'synthetic queue failure'); END");
    expect(() => queueManualEdition(db)).toThrow("synthetic queue failure");
    expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), { behavior: "immediate" });
    expect(db.select().from(editions).all()).toEqual([]);
    expect(db.select().from(collectorRuns).all()).toEqual([]);
  });
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
