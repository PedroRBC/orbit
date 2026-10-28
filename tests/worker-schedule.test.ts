import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/index";
import { collectorRuns, sources } from "../src/db/schema";

it("o worker real dispara a agenda sem acessar rede ou IA externa", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-cron-worker-"));
  const path = join(directory, "orbit.db");
  const db = openDatabase(path);
  db.insert(sources).values({ channelId: "https://127.0.0.1/blocked-rss", name: "Fixture bloqueada antes da rede", kind: "news_rss", platform: "news" }).run();
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], { stdio: "ignore", env: { ...process.env, ORBIT_DB_PATH: path, SCHEDULER_ENABLED: "true", COLLECTOR_CRON: "* * * * * *", COLLECTOR_TIMEZONE: "UTC", AI_BASE_URL: "", AI_API_KEY: "", AI_MODEL: "", AI_BRIEFING_MODEL: "" } });
  try {
    await expect.poll(() => db.select().from(collectorRuns).all().some(run => run.parentId === null && run.trigger === "scheduled" && run.status === "partial"), { timeout: 10000 }).toBe(true);
    expect(db.select().from(collectorRuns).all().some(run => run.status === "unsafe_source")).toBe(true);
  } finally {
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.once("error", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
    db.$client.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
