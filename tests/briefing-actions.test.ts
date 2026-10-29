import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/index";
import { collectorRuns, editions, interestProfile } from "../src/db/schema";
import { setSetting } from "../src/lib/store";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof openDatabase> | undefined, requireSession: vi.fn(async () => {}), revalidatePath: vi.fn() }));
vi.mock("../src/lib/session", () => ({ requireSession: state.requireSession }));
vi.mock("../src/db/index", async importOriginal => ({ ...await importOriginal<typeof import("../src/db/index")>(), getDatabase: () => state.db! }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
import { requestPersonalBriefing, requestGeneralBriefing } from "../src/app/actions";

beforeEach(() => {
  state.db = openDatabase(":memory:"); vi.clearAllMocks();
  for (const [key, value] of Object.entries({ AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "synthetic-secret-never-render", AI_MODEL: "classification", AI_BRIEFING_MODEL: "briefing", AI_PROTOCOL: "openai", AI_DAILY_TOKEN_LIMIT: "50000", AI_DAILY_USD_LIMIT: "", COLLECTOR_TIMEZONE: "" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); state.db?.$client.close(); state.db = undefined; });
function profile() { state.db!.insert(interestProfile).values({ id: 1, interests: "Ciência", excluded: "", updatedAt: 1 }).run(); }
it("pessoal recusa sem interesses antes de enfileirar", async () => {
  expect(await requestPersonalBriefing()).toEqual({ error: true, message: "Configure seus interesses antes de atualizar o briefing pessoal." });
  expect(state.db!.select().from(collectorRuns).all()).toEqual([]);
});
it.each([requestPersonalBriefing, requestGeneralBriefing])("preserva a falta real da configuração e não enfileira", async action => {
  profile(); vi.stubEnv("AI_BASE_URL", "");
  expect(await action()).toEqual({ error: true, message: "Configure AI_BASE_URL para gerar briefings." });
  expect(state.db!.select().from(collectorRuns).all()).toEqual([]);
});
it("geral exige fuso confirmado", async () => {
  expect(await requestGeneralBriefing()).toEqual({ error: true, message: "Confirme o fuso das edições em Configurações antes de gerar um briefing geral." });
  expect(state.db!.select().from(editions).all()).toEqual([]);
});
it.each(["personal", "general"])("%s informa orçamento, worker offline/online, fila ativa e intervalo", async kind => {
  const db = state.db!; profile(); setSetting(db, "edition_schedule", JSON.stringify({ enabled: false, timezone: "UTC" }));
  const action = kind === "personal" ? requestPersonalBriefing : requestGeneralBriefing;
  let result = await action();
  expect(result.error).not.toBe(true);
  expect(result.message).toContain("Usa o orçamento diário de IA compartilhado.");
  expect(result.message).toMatch(/worker.*sem sinal|worker.*offline/i);
  expect((await action()).error).toBe(true);
  db.update(collectorRuns).set({ status: "completed", finishedAt: Date.now() }).run();
  db.update(editions).set({ status: "published" }).run();
  expect((await action()).message).toMatch(/cinco minutos/);
  db.update(collectorRuns).set({ startedAt: Date.now() - 300001 }).run();
  setSetting(db, "worker_heartbeat", String(Date.now()));
  result = await action();
  expect(result.error).not.toBe(true);
  expect(result.message).toMatch(/worker.*online/i);
  expect(result.message).not.toContain("synthetic-secret-never-render");
  for (const path of ["/", "/briefings", "/status"]) expect(state.revalidatePath).toHaveBeenCalledWith(path);
});
it.each([requestPersonalBriefing, requestGeneralBriefing])("sessão recusada impede fila antes de tocar no banco", async action => {
  state.requireSession.mockRejectedValueOnce(new Error("Sessão necessária"));
  await expect(action()).rejects.toThrow("Sessão necessária");
  expect(state.db!.select().from(collectorRuns).all()).toEqual([]);
});
