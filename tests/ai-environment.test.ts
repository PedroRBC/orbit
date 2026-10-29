import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as filesystem from "node:fs";
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiStatus, getAIConfig } from "../src/lib/config";
import { readAIEnvironment, readEnvironment } from "../src/lib/ai-environment";
import { openDatabase } from "../src/db/index";
import { collectorRuns, sources } from "../src/db/schema";
import { acquireLease } from "../src/lib/store";
import { claimCaptureJob, completeCaptureJob, createCaptureJob, captureResult } from "../src/lib/extension";
import { collectorForSource } from "../src/collectors/registry";

const directories: string[] = [];
function environmentFile(content: string) {
  const path = mkdtempSync(join(tmpdir(), "orbit-environment-")); directories.push(path);
  const file = join(path, "orbit.env"); writeFileSync(file, content); return file;
}
it("ORBIT_PUSH_SUBJECT do arquivo vence o contêiner vazio", () => {
  const file = environmentFile("ORBIT_PUSH_SUBJECT=mailto:a@exemplo.org\n");
  const config = readEnvironment({ ORBIT_ENV_FILE: file, ORBIT_PUSH_SUBJECT: "" });
  expect(config.env.ORBIT_PUSH_SUBJECT).toBe("mailto:a@exemplo.org");
  expect(config.source("ORBIT_PUSH_SUBJECT")).toBe("arquivo");
  expect(config.file).toEqual({ label: file, state: "carregado" });
});
it("COLLECTOR_TIMEZONE do ambiente vale sem chave no arquivo", () => {
  const config = readEnvironment({ ORBIT_ENV_FILE: environmentFile("COLLECTOR_CRON=\n"), COLLECTOR_TIMEZONE: "UTC", COLLECTOR_CRON: "0 12 * * *" });
  expect(config.env.COLLECTOR_TIMEZONE).toBe("UTC");
  expect(config.source("COLLECTOR_TIMEZONE")).toBe("ambiente");
  expect(config.env.COLLECTOR_CRON).toBe("0 12 * * *");
  expect(config.source("AI_MODEL")).toBe("ausente");
});
it("AI_* do contêiner é ignorado quando o arquivo existe", () => {
  const config = readEnvironment({ ORBIT_ENV_FILE: environmentFile("AI_PROTOCOL=openai\n"), AI_MODEL: "old-model" });
  expect(config.ignoredContainerAI).toContain("AI_MODEL");
  expect(config.env.AI_MODEL).toBeUndefined();
  expect(config.source("AI_MODEL")).toBe("ausente");
  expect(config.source("AI_PROTOCOL")).toBe("arquivo");
});
it("arquivo ilegível não lança", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-unreadable-")); directories.push(directory);
  const config = readEnvironment({ ORBIT_ENV_FILE: directory, AI_MODEL: "old-model" });
  expect(config.file).toEqual({ label: directory, state: "ilegível" });
  expect(config.env.AI_MODEL).toBeUndefined();
  expect(config.ignoredContainerAI).toContain("AI_MODEL");
});
it("não escreve em process.env", () => {
  vi.stubEnv("ORBIT_ENV_FILE", environmentFile("AI_MODEL=file-model\nCOLLECTOR_TIMEZONE=UTC\nORBIT_ALLOWED_HOSTS=evil.example\nPORT=9999\n"));
  vi.stubEnv("AI_MODEL", "container-model"); vi.stubEnv("PORT", "3000");
  const before = { ...process.env };
  const config = readEnvironment();
  expect(process.env).toEqual(before);
  expect(config.env.PORT).toBe("3000");
  expect(config.env.ORBIT_ALLOWED_HOSTS).toBe(before.ORBIT_ALLOWED_HOSTS);
  expect(config.source("PORT")).toBe("ausente");
  expect(readAIEnvironment()).toEqual(config.env);
});
it("arquivo ausente mantém o ambiente e arquivo desativado não é lido", () => {
  const file = environmentFile(""); rmSync(file);
  expect(readEnvironment({ ORBIT_ENV_FILE: file, AI_MODEL: "model" })).toMatchObject({ env: { AI_MODEL: "model" }, file: { label: file, state: "ausente" }, ignoredContainerAI: [] });
  expect(readEnvironment({ ORBIT_ENV_FILE: "", AI_MODEL: "model" })).toMatchObject({ file: { label: "desativado", state: "não usado" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("COLLECTOR_MAX_ITEMS do arquivo limita RSS e capturas da extensão", async () => {
  vi.stubEnv("ORBIT_ENV_FILE", environmentFile("COLLECTOR_MAX_ITEMS=1\n")); vi.stubEnv("COLLECTOR_MAX_ITEMS", "2");
  const channel = `UC${"a".repeat(22)}`;
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Sintético</title>${["abcdefghijk", "lmnopqrstuv"].map(id => `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>Fixture</title></entry>`).join("")}</feed>`;
  vi.stubGlobal("fetch", async () => new Response(xml));
  const db = openDatabase(":memory:");
  try {
    const rss = db.insert(sources).values({ channelId: channel, name: "RSS sintético" }).returning().get();
    expect(await collectorForSource(rss, db, 0).collect()).toHaveLength(1);
    const browser = db.insert(sources).values({ channelId: "https://www.youtube.com/", name: "Home sintética", kind: "youtube_home" }).returning().get();
    acquireLease(db, "owner");
    const parent = db.insert(collectorRuns).values({ status: "running", startedAt: Date.now() }).returning().get();
    const run = db.insert(collectorRuns).values({ sourceId: browser.id, parentId: parent.id, status: "running", startedAt: Date.now() }).returning().get();
    const job = createCaptureJob(db, browser.id, run.id);
    expect(claimCaptureJob(db)?.maxItems).toBe(1);
    const item = { platform: "youtube", externalId: "abcdefghijk", title: "Fixture", text: "", author: "Sintético", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: null, durationSeconds: null };
    expect(() => completeCaptureJob(db, job.id, { items: [item, item] })).toThrow(/limite/);
    completeCaptureJob(db, job.id, { items: [item] });
    expect(captureResult(db, job.id)).toHaveLength(1);
  } finally { db.$client.close(); }
});
it(".env.local vence .env, mas chave não-AI vazia volta ao ambiente", () => {
  const file = environmentFile("");
  const directory = join(file, "..");
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  writeFileSync(join(directory, ".env"), "AI_MODEL=first\nCOLLECTOR_TIMEZONE=Europe/Lisbon\nCOLLECTOR_MAX_ITEMS=1\n");
  writeFileSync(join(directory, ".env.local"), "AI_MODEL=last\nCOLLECTOR_TIMEZONE=\nCOLLECTOR_MAX_ITEMS=2\n");
  const config = readEnvironment({ COLLECTOR_TIMEZONE: "UTC", AI_API_KEY: "container-secret" });
  expect(config.file).toEqual({ label: ".env / .env.local", state: "carregado" });
  expect(config.env.AI_MODEL).toBe("last");
  expect(config.env.COLLECTOR_TIMEZONE).toBe("UTC");
  expect(config.source("COLLECTOR_TIMEZONE")).toBe("ambiente");
  expect(config.env.COLLECTOR_MAX_ITEMS).toBe("2");
  expect(config.env.AI_API_KEY).toBeUndefined();
});
it("qualquer candidato ilegível mantém a IA fechada mesmo com outro carregado", () => {
  const file = environmentFile("");
  const directory = join(file, "..");
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  writeFileSync(join(directory, ".env"), "AI_MODEL=file-model\n");
  mkdirSync(join(directory, ".env.local"));
  const config = readEnvironment({ AI_MODEL: "container-model" });
  expect(config.file.state).toBe("ilegível");
  expect(config.env.AI_MODEL).toBeUndefined();
});
it("arquivo removido entre stat e leitura é ilegível e não reativa IA herdada", () => {
  const file = environmentFile("AI_MODEL=file-model\n");
  vi.mocked(filesystem.readFileSync).mockImplementationOnce(() => {
    rmSync(file);
    throw Object.assign(new Error("Arquivo removido"), { code: "ENOENT" });
  });
  const config = readEnvironment({ ORBIT_ENV_FILE: file, AI_MODEL: "container-model" });
  expect(config.file.state).toBe("ilegível");
  expect(config.env.AI_MODEL).toBeUndefined();
});
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
