import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiStatus, getAIConfig } from "../src/lib/config";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("relê a configuração de IA do arquivo sem usar a cópia antiga herdada pelo worker", () => {
  const path = mkdtempSync(join(tmpdir(), "orbit-ai-env-")); directories.push(path);
  const file = join(path, ".env");
  vi.stubEnv("ORBIT_ENV_FILE", file);
  vi.stubEnv("AI_MODEL", "old-inherited-model");
  writeFileSync(file, 'AI_PROTOCOL=openai\nAI_BASE_URL=https://api.example.com/v1\nAI_API_KEY=test-only\nAI_MODEL=current-file-model\n');
  expect(getAIConfig()?.model).toBe("current-file-model");
  writeFileSync(file, 'AI_PROTOCOL=openai\nAI_BASE_URL=https://api.example.com/v1\nAI_API_KEY=test-only\nAI_MODEL=updated-file-model\n');
  expect(getAIConfig()?.model).toBe("updated-file-model");
  writeFileSync(file, 'AI_PROTOCOL=openai\n');
  expect(getAIConfig()).toBeNull();
});
it("carrega o CliProxyApi por HTTP na rede do NAS sem expor a chave no status", () => {
  vi.stubEnv("ORBIT_ENV_FILE", "");
  vi.stubEnv("AI_PROTOCOL", "openai"); vi.stubEnv("AI_BASE_URL", "http://192.168.1.3:8317/v1");
  vi.stubEnv("AI_API_KEY", "test-only-key"); vi.stubEnv("AI_MODEL", "custom-model");
  const status = aiStatus();
  expect(status).toMatchObject({ ready: true, state: "ready", protocol: "openai", model: "custom-model" });
  expect(JSON.stringify(status)).not.toContain("test-only-key");
});
