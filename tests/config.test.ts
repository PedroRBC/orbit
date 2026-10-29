import { afterEach, expect, it, vi } from "vitest";
import { aiStatus, briefingProblem, getBriefingConfig } from "../src/lib/config";
import { openDatabase } from "../src/db/index";
import { briefings, editions, processedItems, rawItems, sources } from "../src/db/schema";
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const db of databases.splice(0)) db.$client.close(); });
const valid = { AI_BASE_URL: "https://api.exemplo.org:8443/private/v1", AI_API_KEY: "synthetic-secret-key", AI_MODEL: "classification", AI_BRIEFING_MODEL: "briefing" };
function configure(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ AI_PROTOCOL: "openai", AI_DAILY_TOKEN_LIMIT: "", AI_DAILY_USD_LIMIT: "", AI_INPUT_USD_PER_MILLION: "", AI_OUTPUT_USD_PER_MILLION: "", AI_BRIEFING_INPUT_USD_PER_MILLION: "", AI_BRIEFING_OUTPUT_USD_PER_MILLION: "", ...valid, ...overrides })) vi.stubEnv(key, value);
}
it("briefingProblem cita a variável que falta", () => {
  expect(briefingProblem({ ...valid, AI_MODEL: "" })).toContain("AI_MODEL");
  expect(briefingProblem({ ...valid, AI_BASE_URL: "" })).toContain("AI_BASE_URL");
  expect(briefingProblem({ ...valid, AI_API_KEY: "" })).toContain("AI_API_KEY");
  expect(briefingProblem({ ...valid, AI_BRIEFING_MODEL: "" })).toContain("AI_BRIEFING_MODEL");
  const prices = { AI_DAILY_USD_LIMIT: "1", AI_INPUT_USD_PER_MILLION: "1", AI_OUTPUT_USD_PER_MILLION: "2" };
  expect(briefingProblem({ ...valid, ...prices })).toContain("AI_BRIEFING_INPUT_USD_PER_MILLION");
  expect(briefingProblem({ ...valid, ...prices, AI_BRIEFING_INPUT_USD_PER_MILLION: "1" })).toContain("AI_BRIEFING_OUTPUT_USD_PER_MILLION");
  expect(briefingProblem(valid)).toBeNull();
  expect(briefingProblem({ ...valid, ...prices, AI_BRIEFING_INPUT_USD_PER_MILLION: "1", AI_BRIEFING_OUTPUT_USD_PER_MILLION: "2" })).toBeNull();
});
it.each(["AI_DAILY_TOKEN_LIMIT", "AI_DAILY_USD_LIMIT", "AI_MAX_OUTPUT_TOKENS", "AI_INPUT_USD_PER_MILLION", "AI_OUTPUT_USD_PER_MILLION", "AI_PROTOCOL"])("limites inválidos citam a variável: %s", key => {
  configure({ [key]: "abc" });
  expect(aiStatus().message).toContain(key);
  expect(aiStatus().message).not.toContain("abc");
});
it("preços inválidos do briefing citam AI_BRIEFING_*", () => {
  expect(() => getBriefingConfig({ ...valid, AI_BRIEFING_INPUT_USD_PER_MILLION: "secret-invalid" })).toThrow(/AI_BRIEFING_INPUT_USD_PER_MILLION/);
  expect(() => getBriefingConfig({ ...valid, AI_BRIEFING_OUTPUT_USD_PER_MILLION: "secret-invalid" })).toThrow(/AI_BRIEFING_OUTPUT_USD_PER_MILLION/);
});
it("diagnóstico não expõe segredos", () => {
  configure(); vi.stubEnv("ORBIT_PUSH_SUBJECT", "mailto:private@exemplo.org");
  const db = openDatabase(":memory:"); databases.push(db);
  const status = aiStatus(db), serialized = JSON.stringify(status);
  expect(serialized).not.toContain(valid.AI_API_KEY);
  expect(serialized).not.toContain("private@exemplo.org");
  expect(serialized).not.toContain("/private/v1");
  expect(status.endpoint?.host).toBe("api.exemplo.org:8443");
  expect(status.apiKey).toBe("definida");
  expect(status.classification).toMatchObject({ model: "classification", source: "ambiente", state: "carregado", reason: null, lastSuccessAt: null });
  expect(status.briefing).toMatchObject({ model: "briefing", source: "ambiente", state: "carregado", reason: null, lastSuccessAt: null });
  expect(status.pushContact).toEqual({ state: "definido", source: "ambiente" });
});
it("modelo de briefing fica incompleto sem classificação ou preços próprios", () => {
  configure({ AI_MODEL: "" });
  expect(aiStatus()).toMatchObject({ briefingReady: false, classification: { state: "ausente" }, briefing: { state: "incompleto" } });
  configure({ AI_DAILY_USD_LIMIT: "1", AI_INPUT_USD_PER_MILLION: "1", AI_OUTPUT_USD_PER_MILLION: "1" });
  expect(aiStatus()).toMatchObject({ ready: true, briefingReady: false, briefing: { state: "incompleto" } });
  configure({ AI_BRIEFING_INPUT_USD_PER_MILLION: "invalid-price" });
  expect(aiStatus()).toMatchObject({ ready: true, briefing: { state: "inválido" } });
});
it.each([["", "ausente"], ["mailto:invalid", "inválido"], ["https://localhost", "inválido"], ["https://exemplo.org/contato", "definido"]])("diagnostica contato de push sem expor valor %s", (contact, state) => {
  configure(); vi.stubEnv("ORBIT_PUSH_SUBJECT", contact);
  expect(aiStatus().pushContact.state).toBe(state);
});
it("último sucesso por modelo", () => {
  configure();
  const db = openDatabase(":memory:"); databases.push(db);
  const source = db.insert(sources).values({ channelId: "synthetic", name: "Fixture" }).returning().get();
  for (const [id, model, processedAt] of [["a", "classification", 123], ["b", "classification", 100], ["c", "other", 999]] as const) {
    db.insert(rawItems).values({ id, sourceId: source.id, platform: "youtube", externalId: id, title: "Sintético", text: "", author: "Fixture", url: `https://example.org/${id}`, fetchedAt: 1 }).run();
    db.insert(processedItems).values({ rawId: id, theme: "outros", tone: "informativo", language: "pt", type: "notícia", score: 50, reason: "Fixture", summary: "Sintético", isSpam: false, model, processedAt }).run();
  }
  for (const [model, createdAt] of [["briefing", 200], ["other", 900]] as const) db.insert(briefings).values({ snapshot: model, introduction: "Sintético", createdAt, windowFrom: 1, windowTo: 2, model, sourceCount: 1 }).run();
  for (const [slot, model, status, generatedAt] of [["a", "briefing", "published", 300], ["b", "briefing", "error", 800], ["c", "other", "published", 999]] as const) db.insert(editions).values({ slot, localDate: "2026-10-28", edition: "morning", timezone: "UTC", scheduledAt: 1, windowFrom: 1, windowTo: 2, createdAt: 1, status, model, generatedAt }).run();
  expect(aiStatus(db).classification.lastSuccessAt).toBe(123);
  expect(aiStatus(db).briefing.lastSuccessAt).toBe(300);
  expect(aiStatus().classification.lastSuccessAt).toBeNull();
  expect(aiStatus().briefing.lastSuccessAt).toBeNull();
});
it("mostra os limites configurados mesmo antes de fornecer uma chave", () => {
  vi.stubEnv("AI_BASE_URL", ""); vi.stubEnv("AI_API_KEY", ""); vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_DAILY_TOKEN_LIMIT", "12345"); vi.stubEnv("AI_DAILY_USD_LIMIT", "0.5");
  expect(aiStatus()).toMatchObject({ ready: false, tokenLimit: 12345, costLimit: 0.5 });
});
