import { it, expect } from "vitest";
import Sqlite from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase } from "../src/db/index";
import { interestProfile, processedItems, sourceItems, sources } from "../src/db/schema";

it("migra banco da fase 1 sem apagar interesses, fontes ou classificações", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-migration-"));
  const path = join(directory, "orbit.db");
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    const initial = readFileSync("drizzle/0000_swift_sebastian_shaw.sql", "utf8");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const old = new Sqlite(path);
    old.exec(initial);
    old.exec('CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)');
    old.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run(createHash("sha256").update(initial).digest("hex"), journal.entries[0].when);
    old.exec("INSERT INTO sources (channelId, name) VALUES ('channel', 'Canal preservado'); INSERT INTO interest_profile (id, interests, excluded, updatedAt) VALUES (1, 'Ciência', 'Spam', 1); INSERT INTO raw_items (id, sourceId, platform, externalId, title, text, author, url, fetchedAt) VALUES ('youtube:item', 1, 'youtube', 'item', 'Aula', 'Texto', 'Autor', 'https://example.com/item', 1); INSERT INTO processed_items (rawId, theme, tone, language, type, score, reason, summary, isSpam, model, processedAt) VALUES ('youtube:item', 'Ciência', 'informativo', 'pt', 'educação', 80, 'Perfil', 'Resumo', 0, 'old-model', 1)");
    old.close();
    db = openDatabase(path);
    expect(db.select().from(sources).get()).toMatchObject({ name: "Canal preservado", kind: "youtube_rss", platform: "youtube" });
    expect(db.select().from(sourceItems).get()).toEqual({ sourceId: 1, rawId: "youtube:item" });
    expect(db.select().from(interestProfile).get()).toMatchObject({ interests: "Ciência", excluded: "Spam", weights: "{}" });
    expect(db.select().from(processedItems).get()).toMatchObject({ score: 80, model: "old-model", clusterId: null });
  } finally { db?.$client.close(); rmSync(directory, { recursive: true, force: true }); }
});
