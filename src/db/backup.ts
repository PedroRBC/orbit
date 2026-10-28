import Sqlite from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Usa a API online do SQLite: copia páginas do banco e do WAL sem parar app e worker.
export async function backupDatabase(source: string, directory: string, now = new Date()) {
  const client = new Sqlite(source, { readonly: true, fileMustExist: true });
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `orbit-${now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.db`);
    await client.backup(file);
    // Cópia em arquivo único (sem -wal/-shm), pronta para restaurar.
    const copy = new Sqlite(file);
    try {
      copy.pragma("journal_mode = DELETE");
      if (copy.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Cópia falhou na verificação de integridade.");
    }
    finally { copy.close(); }
    return file;
  } finally { client.close(); }
}
