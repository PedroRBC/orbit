import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, companionJobs, editions, sources } from "../src/db/schema";
import { setSetting } from "../src/lib/store";

it("worker real executa edição sem acionar feeds pessoais nem serviços externos", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-edition-worker-"));
  const path = join(directory, "orbit.db");
  const db = openDatabase(path);
  const now = Date.now();
  setSetting(db, "edition_schedule", JSON.stringify({ enabled: false, timezone: "UTC" }));
  db.insert(sources).values({ channelId: "https://127.0.0.1/blocked-rss", name: "Fixture bloqueada antes da rede", kind: "news_rss", platform: "news" }).run();
  db.insert(sources).values({ channelId: "https://www.youtube.com/", name: "Feed pessoal sintético", kind: "youtube_home", platform: "youtube" }).run();
  const edition = db.insert(editions).values({ slot: "worker-fixture", localDate: "2026-10-28", edition: "morning", timezone: "UTC", scheduledAt: now, windowFrom: now - 86400000, windowTo: now, createdAt: now }).returning().get();
  db.insert(collectorRuns).values({ kind: "edition", editionId: edition.id, status: "queued", startedAt: now }).run();
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], { stdio: "ignore", env: { ...process.env, ORBIT_ENV_FILE: "", ORBIT_DB_PATH: path, SCHEDULER_ENABLED: "false", AI_BASE_URL: "", AI_API_KEY: "", AI_MODEL: "", AI_BRIEFING_MODEL: "", ORBIT_PUSH_SUBJECT: "" } });
  try {
    await expect.poll(() => db.select().from(editions).where(eq(editions.id, edition.id)).get()?.status, { timeout: 10000 }).toBe("unavailable");
    const children = db.select().from(collectorRuns).all().filter(run => run.parentId);
    expect(children).toHaveLength(1);
    expect(children[0].status).toBe("unsafe_source");
    expect(db.select().from(companionJobs).all()).toEqual([]);
  } finally {
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.once("error", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
    db.$client.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
