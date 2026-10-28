import Sqlite from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const client = new Sqlite(path);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve("drizzle") });
  return db;
}
export type OrbitDB = ReturnType<typeof openDatabase>;
const state = globalThis as typeof globalThis & { orbitDatabase?: OrbitDB };
export function getDatabase(): OrbitDB {
  return state.orbitDatabase ??= openDatabase(process.env.ORBIT_DB_PATH || "data/orbit.db");
}
