import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  webServer: {
    command: process.env.E2E_PRODUCTION === "1" ? "npm start" : "npm run dev",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ORBIT_ENV_FILE: "", ORBIT_PUSH_SUBJECT: "mailto:e2e@exemplo.org", PORT: "3101", ORBIT_HOST: "127.0.0.1", ORBIT_DB_PATH: resolve("test-results/e2e.db"), AI_BASE_URL: "", AI_API_KEY: "synthetic-e2e-api-key-never-render", AI_MODEL: "", SCHEDULER_ENABLED: "false", AI_DAILY_TOKEN_LIMIT: "50000", AI_DAILY_USD_LIMIT: "" },
  },
});
