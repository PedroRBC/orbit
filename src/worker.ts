import "dotenv/config";
import cron, { type ScheduledTask } from "node-cron";
import { queueScheduledRun, readSchedule } from "./lib/scheduler";
import { queueDueEdition, readEditionSchedule } from "./lib/editions";
import { drainPush } from "./lib/push";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDatabase } from "./db/index";
import { collectorRuns, settings } from "./db/schema";
import { acquireLease, assertLease, claimRun, recoverRuns, setSetting } from "./lib/store";
import { runWithConfiguredAI } from "./lib/run";

process.umask(0o077);
const db = getDatabase();
const owner = randomUUID();
let stopping = false;
let active = false;
let controller: AbortController | undefined;
let scheduled: ScheduledTask | undefined;
let scheduleKey = "";
let editionTick = "";
function stop() { stopping = true; controller?.abort(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const assertActive = () => { if (!active || stopping) throw new Error("Worker interrompido."); assertLease(db, owner); };

const heartbeat = setInterval(() => {
  if (active && !acquireLease(db, owner)) { active = false; stop(); }
}, 10_000);

console.log("Worker Orbit pronto. Coletas manuais e agenda local, com lease e fontes habilitadas.");
try {
  while (!stopping) {
    if (!active) {
      active = acquireLease(db, owner);
      if (active) recoverRuns(db, assertActive);
    }
    if (active) {
      const config = readSchedule(db);
      const key = JSON.stringify(config);
      if (key !== scheduleKey) {
        await scheduled?.destroy(); scheduled = undefined; scheduleKey = key;
        assertActive();
        setSetting(db, "scheduler_notice", config.error || "");
        if (config.enabled && !config.error) scheduled = cron.schedule(config.expression, context => {
          try {
            assertActive();
            const current = readSchedule(db);
            if (current.expression === config.expression && current.timezone === config.timezone) queueScheduledRun(db, owner, context.date);
            setSetting(db, "scheduler_next", scheduled?.getNextRun()?.toISOString() || "");
          } catch { /* Outro worker assumiu ou a agenda foi pausada; não duplicar a fila. */ }
        }, { timezone: config.timezone, noOverlap: true, name: "orbit-collect" });
        setSetting(db, "scheduler_next", scheduled?.getNextRun()?.toISOString() || "");
      }
      const tick = `${Math.floor(Date.now() / 60000)}:${JSON.stringify(readEditionSchedule(db))}`;
      if (tick !== editionTick) { assertActive(); queueDueEdition(db, owner); editionTick = tick; }
      const run = claimRun(db, assertActive);
      if (run) {
        controller = new AbortController();
        try {
          await runWithConfiguredAI(db, run.id, undefined, { assertActive, signal: controller.signal });
        } catch {
          // Se houve transferência de lease, só o novo dono pode recuperar ou finalizar o job.
          try {
            db.transaction(() => {
              assertActive();
              const message = "Execução interrompida. Confira a configuração de IA no servidor (.env ou orbit.env) e tente novamente.";
              setSetting(db, "ai_notice", message);
              db.update(collectorRuns).set({ status: "error", error: message, finishedAt: Date.now() }).where(eq(collectorRuns.id, run.id)).run();
            }, { behavior: "immediate" });
          } catch { active = false; stopping = true; }
        } finally { controller = undefined; }
      }
      if (!stopping && active) {
        controller = new AbortController();
        try { await drainPush(db, assertActive, controller.signal); }
        catch { active = false; stopping = true; }
        finally { controller = undefined; }
      }
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  clearInterval(heartbeat);
  await scheduled?.destroy();
  db.transaction(() => {
    try { assertLease(db, owner); db.delete(settings).where(eq(settings.key, "worker_lease")).run(); } catch { /* Outro worker já assumiu. */ }
  }, { behavior: "immediate" });
  db.$client.close();
}
