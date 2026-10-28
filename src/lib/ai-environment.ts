import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export function readAIEnvironment(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env = { ...base };
  const override = base.ORBIT_ENV_FILE;
  const files = override === undefined ? [resolve(".env"), resolve(".env.local")] : override.trim() ? [resolve(override)] : [];
  if (files.some(file => existsSync(file))) for (const name of Object.keys(env)) if (name.startsWith("AI_")) delete env[name];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const values = parse(readFileSync(file));
    for (const [name, value] of Object.entries(values)) if (name.startsWith("AI_")) env[name] = value;
  }
  return env;
}
