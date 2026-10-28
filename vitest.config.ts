import { defineConfig } from "vitest/config";
export default defineConfig({ test: { env: { ORBIT_ENV_FILE: "", ORBIT_DB_PATH: ":memory:" }, include: ["tests/**/*.test.ts"] } });
