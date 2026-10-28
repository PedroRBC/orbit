import { afterEach, expect, it, vi } from "vitest";
import { aiStatus } from "../src/lib/config";
afterEach(() => vi.unstubAllEnvs());
it("mostra os limites configurados mesmo antes de fornecer uma chave", () => {
  vi.stubEnv("AI_BASE_URL", ""); vi.stubEnv("AI_API_KEY", ""); vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_DAILY_TOKEN_LIMIT", "12345"); vi.stubEnv("AI_DAILY_USD_LIMIT", "0.5");
  expect(aiStatus()).toMatchObject({ ready: false, tokenLimit: 12345, costLimit: 0.5 });
});
