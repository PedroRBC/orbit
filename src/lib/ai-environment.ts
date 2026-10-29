import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export const FILE_KEYS: readonly string[] = ["ORBIT_PUSH_SUBJECT", "COLLECTOR_CRON", "COLLECTOR_TIMEZONE", "COLLECTOR_MAX_RUNS_PER_DAY", "COLLECTOR_MAX_ITEMS", "SCHEDULER_ENABLED"];
export type EnvSource = "arquivo" | "ambiente" | "ausente";
export type EnvironmentFile = { label: string; state: "não usado" | "ausente" | "ilegível" | "carregado" };
export type Environment = { env: Record<string, string | undefined>; source(key: string): EnvSource; file: EnvironmentFile; ignoredContainerAI: string[] };

const origins = new WeakMap<Record<string, string | undefined>, Record<string, EnvSource>>();
const knownKey = (key: string) => key.startsWith("AI_") || FILE_KEYS.includes(key);
// Preserva a origem do leitor; objetos explícitos dos chamadores não provocam nova leitura.
export function environmentSource(env: Record<string, string | undefined>, key: string): EnvSource {
  if (!knownKey(key)) return "ausente";
  return origins.get(env)?.[key] ?? (env[key]?.trim() ? "ambiente" : "ausente");
}

export function readEnvironment(base: Record<string, string | undefined> = process.env): Environment {
  const env = { ...base };
  const override = base.ORBIT_ENV_FILE;
  const files = override === undefined ? [".env", ".env.local"] : override.trim() ? [override] : [];
  const file: EnvironmentFile = { label: override === undefined ? ".env / .env.local" : files.length ? override : "desativado", state: files.length ? "ausente" : "não usado" };
  const values: Record<string, string> = {};
  let exists = false;
  for (const candidate of files) {
    let present = false;
    try {
      const path = resolve(candidate);
      const stat = statSync(path);
      present = exists = true;
      if (!stat.isFile()) throw new Error("Não é um arquivo");
      const parsed = parse(readFileSync(path));
      for (const [key, value] of Object.entries(parsed)) if (knownKey(key)) values[key] = value;
      if (file.state !== "ilegível") file.state = "carregado";
    } catch (error) {
      if (!present && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      exists = true;
      file.state = "ilegível";
    }
  }
  const ignoredContainerAI = exists ? Object.keys(base).filter(key => key.startsWith("AI_") && base[key] !== undefined) : [];
  if (exists) for (const key of Object.keys(env)) if (key.startsWith("AI_")) delete env[key];
  for (const key of FILE_KEYS) if (!env[key]?.trim()) delete env[key];
  const sources: Record<string, EnvSource> = {};
  for (const [key, value] of Object.entries(env)) if (knownKey(key) && value?.trim()) sources[key] = "ambiente";
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("AI_") && file.state === "ilegível") continue;
    if (FILE_KEYS.includes(key) && !value.trim()) continue;
    env[key] = value;
    sources[key] = value.trim() ? "arquivo" : "ausente";
  }
  origins.set(env, sources);
  return { env, source: key => environmentSource(env, key), file, ignoredContainerAI };
}

export function readAIEnvironment(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return readEnvironment(base).env;
}
