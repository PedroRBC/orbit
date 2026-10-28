import { defineConfig } from "vitest/config";
export default defineConfig({ test: { env: { ORBIT_ENV_FILE: "" }, include: ["tests/**/*.test.ts"] } });
