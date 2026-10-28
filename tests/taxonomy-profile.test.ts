import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/index";
import { interestProfile } from "../src/db/schema";
import { TAXONOMY } from "../src/lib/taxonomy";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof openDatabase> | undefined, requireSession: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("../src/lib/session", () => ({ requireSession: state.requireSession }));
vi.mock("../src/db/index", async importOriginal => ({ ...await importOriginal<typeof import("../src/db/index")>(), getDatabase: () => state.db! }));
vi.mock("../src/app/actions", () => ({ saveProfile: vi.fn(), saveTopicWeight: vi.fn() }));
vi.mock("../src/app/components", () => ({
  ActionForm: ({ children, className }: { children: ReactNode; className: string }) => createElement("form", { className }, children),
  SubmitButton: ({ children }: { children: ReactNode }) => createElement("button", { type: "submit" }, children),
}));
import ProfilePage from "../src/app/(app)/perfil/page";

beforeEach(() => { state.db = openDatabase(":memory:"); state.requireSession.mockClear(); });
afterEach(() => { state.db?.$client.close(); state.db = undefined; });

describe("catálogo de temas no perfil", () => {
  it("mostra a âncora e os oito temas com escopos, mesmo sem perfil, sem persistir zeros", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(state.requireSession).toHaveBeenCalledOnce();
    expect(html).toContain('id="temas"');
    expect(html.match(/name="theme"/g)).toHaveLength(8);
    expect(html.match(/name="weight"[^>]*value="0"/g)).toHaveLength(8);
    for (const theme of TAXONOMY) {
      expect(html).toContain(theme.label);
      expect(html).toContain(theme.description);
      expect(html).toContain(`name="theme" value="${theme.id}"`);
      expect(html).toContain(`aria-describedby="scope-${theme.id}"`);
    }
    expect(state.db!.select().from(interestProfile).all()).toEqual([]);
  });
  it("exibe pesos decimais salvos e zeros dos demais temas sem acrescentar preferências", async () => {
    state.db!.insert(interestProfile).values({ id: 1, interests: "Interesses livres", excluded: "Exclusões livres", weights: '{"tecnologia":2.5}', updatedAt: 1 }).run();
    const before = state.db!.select().from(interestProfile).get();
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toMatch(/id="weight-tecnologia"[^>]*step="any"[^>]*value="2.5"/);
    expect(html.match(/name="weight"[^>]*value="0"/g)).toHaveLength(7);
    expect(state.db!.select().from(interestProfile).get()).toEqual(before);
  });
});
