import { afterEach, expect, it } from "vitest";
import Sqlite from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/index";
import { sources } from "../src/db/schema";
import { backupDatabase } from "../src/db/backup";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("copia banco em WAL de forma consistente, inclusive linhas ainda no -wal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-backup-"));
  directories.push(directory);
  const db = openDatabase(join(directory, "orbit.db"));
  db.$client.pragma("wal_autocheckpoint = 0");
  db.insert(sources).values({ channelId: "canal", name: "Canal no WAL" }).run();
  expect(statSync(join(directory, "orbit.db-wal")).size).toBeGreaterThan(0);
  const file = await backupDatabase(join(directory, "orbit.db"), join(directory, "copias"), new Date("2026-10-28T13:04:05Z"));
  db.$client.close();
  expect(file).toBe(join(directory, "copias", "orbit-20261028-130405.db"));
  expect(statSync(join(directory, "copias")).mode & 0o777).toBe(0o700);
  expect(existsSync(`${file}-wal`) || existsSync(`${file}-shm`)).toBe(false);
  const copy = new Sqlite(file, { readonly: true });
  expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
  expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(copy.prepare("SELECT name FROM sources").get()).toEqual({ name: "Canal no WAL" });
  copy.close();
});

it("recusa origem inexistente sem criar banco vazio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-backup-"));
  directories.push(directory);
  await expect(backupDatabase(join(directory, "nao-existe.db"), directory)).rejects.toThrow();
});
