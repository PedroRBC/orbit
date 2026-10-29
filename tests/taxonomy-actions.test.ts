import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/index";
import { feedback, interestProfile, processedItems, rawItems, sources } from "../src/db/schema";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof openDatabase> | undefined, requireSession: vi.fn(async () => {}), revalidatePath: vi.fn() }));
vi.mock("../src/lib/session", () => ({ requireSession: state.requireSession }));
vi.mock("../src/db/index", async importOriginal => ({ ...await importOriginal<typeof import("../src/db/index")>(), getDatabase: () => state.db! }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
import { mergeThemeAction, saveFeedback, saveTopicWeight } from "../src/app/actions";

beforeEach(() => { state.db = openDatabase(":memory:"); vi.clearAllMocks(); });
afterEach(() => { state.db?.$client.close(); state.db = undefined; });
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
function setup() {
  const db = state.db!;
  db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("automotivo", "Automotivo");
  const source = db.insert(sources).values({ channelId: "channel", name: "Fonte sintética" }).returning().get();
  db.insert(rawItems).values({ id: "youtube:fixture", sourceId: source.id, externalId: "fixture", platform: "youtube", title: "Teste", text: "Teste", author: "Teste", url: "https://www.youtube.com/watch?v=abcdefghijk", fetchedAt: 1 }).run();
  db.insert(processedItems).values({ rawId: "youtube:fixture", theme: "automotivo", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Teste", summary: "Teste", isSpam: false, model: "fixture", processedAt: 1 }).run();
  db.insert(interestProfile).values({ id: 1, interests: "Teste", excluded: "", weights: '{"automotivo":6,"outros":2}', updatedAt: 1 }).run();
  return db;
}
it.each(["up", "save"])("feedback RSS confirma apenas a persistência: %s", async action => {
  const db = setup();
  db.update(rawItems).set({ platform: "news" }).run();
  const weights = db.select().from(interestProfile).get()!.weights;
  expect(await saveFeedback({ message: "" }, form({ rawId: "youtube:fixture", action }))).toEqual({ message: "Feedback salvo." });
  expect(state.requireSession).toHaveBeenCalledOnce();
  expect(db.select().from(interestProfile).get()!.weights).toBe(weights);
  expect(db.select().from(feedback).get()).toMatchObject(action === "up" ? { vote: 1 } : { saved: true });
  expect(state.revalidatePath).toHaveBeenCalledWith("/");
});
it("saveTopicWeight distingue tema desconhecido de perfil ausente", async () => {
  expect(await saveTopicWeight({ message: "" }, form({ theme: "inexistente", weight: "2" }))).toEqual({ error: true, message: "Tema não encontrado no catálogo." });
  expect(await saveTopicWeight({ message: "" }, form({ theme: "outros", weight: "2" }))).toEqual({ error: true, message: "Configure seu perfil antes de ajustar os pesos." });
  expect(state.requireSession).toHaveBeenCalledTimes(2);
  expect(state.revalidatePath).not.toHaveBeenCalled();
});
it("junção autenticada usa IMMEDIATE, move itens e pesos e atualiza consumidores", async () => {
  const db = setup();
  const transaction = vi.spyOn(db, "transaction");
  const result = await mergeThemeAction({ message: "" }, form({ from: "automotivo", into: "outros" }));
  expect(state.requireSession).toHaveBeenCalledOnce();
  expect(result.error).not.toBe(true);
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), { behavior: "immediate" });
  expect(db.select().from(processedItems).get()?.theme).toBe("outros");
  expect(JSON.parse(db.select().from(interestProfile).get()!.weights)).toEqual({ outros: 4 });
  expect(db.$client.prepare("SELECT id FROM taxonomy_themes WHERE id = 'automotivo'").get()).toBeUndefined();
  expect(db.$client.prepare("SELECT reason FROM taxonomy_reassignments").pluck().all()).toEqual(["merge"]);
  for (const path of ["/", "/perfil", "/temas"]) expect(state.revalidatePath).toHaveBeenCalledWith(path);
});
it.each([{ from: "x".repeat(41), into: "outros" }, { from: "automotivo", into: "x".repeat(41) }, { from: "", into: "outros" }, { from: "tecnologia", into: "outros" }, { from: "automotivo", into: "automotivo" }, { from: "automotivo", into: "inexistente" }])("rejeita junção inválida sem alterar dados: %j", async values => {
  const db = setup();
  expect((await mergeThemeAction({ message: "" }, form(values))).error).toBe(true);
  expect(db.select().from(processedItems).get()?.theme).toBe("automotivo");
  expect(state.revalidatePath).not.toHaveBeenCalled();
});
it("falha da junção reverte itens, pesos e auditoria sem expor a exceção", async () => {
  const db = setup();
  db.$client.exec("CREATE TRIGGER synthetic_merge_failure BEFORE DELETE ON taxonomy_themes BEGIN SELECT RAISE(ABORT, 'synthetic private detail'); END");
  const result = await mergeThemeAction({ message: "" }, form({ from: "automotivo", into: "outros" }));
  expect(result.error).toBe(true);
  expect(result.message).not.toContain("synthetic private detail");
  expect(db.select().from(processedItems).get()?.theme).toBe("automotivo");
  expect(JSON.parse(db.select().from(interestProfile).get()!.weights)).toEqual({ automotivo: 6, outros: 2 });
  expect(db.$client.prepare("SELECT * FROM taxonomy_reassignments").all()).toEqual([]);
  expect(state.revalidatePath).not.toHaveBeenCalled();
});
it("sessão recusada impede junção antes de tocar no banco", async () => {
  const db = setup();
  state.requireSession.mockRejectedValueOnce(new Error("Sessão necessária"));
  await expect(mergeThemeAction({ message: "" }, form({ from: "automotivo", into: "outros" }))).rejects.toThrow("Sessão necessária");
  expect(db.select().from(processedItems).get()?.theme).toBe("automotivo");
  expect(state.revalidatePath).not.toHaveBeenCalled();
});
