import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/index";
import { interestProfile, processedItems, sources } from "../src/db/schema";
import { SEED_THEMES } from "../src/lib/taxonomy";
import { saveRawItems } from "../src/lib/store";
import { applyThemeProposal } from "../src/lib/themes";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof openDatabase> | undefined, requireSession: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("../src/lib/session", () => ({ requireSession: state.requireSession }));
vi.mock("../src/db/index", async importOriginal => ({ ...await importOriginal<typeof import("../src/db/index")>(), getDatabase: () => state.db! }));
vi.mock("../src/app/actions", () => ({ saveProfile: vi.fn(), saveTopicWeight: vi.fn(), mergeThemeAction: vi.fn() }));
vi.mock("../src/app/components", () => ({
  ActionForm: ({ children, className }: { children: ReactNode; className: string }) => createElement("form", { className }, children),
  SubmitButton: ({ children }: { children: ReactNode }) => createElement("button", { type: "submit" }, children),
}));
import ProfilePage from "../src/app/(app)/perfil/page";
import ThemesPage from "../src/app/(app)/temas/page";

beforeEach(() => { state.db = openDatabase(":memory:"); state.requireSession.mockClear(); });
afterEach(() => { state.db?.$client.close(); state.db = undefined; });

describe("catálogo de temas no perfil", () => {
  it("mostra a âncora e os oito temas com escopos, mesmo sem perfil, sem persistir zeros", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(state.requireSession).toHaveBeenCalledOnce();
    expect(html).toContain('id="temas"');
    expect(html.match(/name="theme"/g)).toHaveLength(8);
    expect(html.match(/name="weight"[^>]*value="0"/g)).toHaveLength(8);
    for (const theme of SEED_THEMES) {
      expect(html).toContain(theme.label);
      expect(html).toContain(theme.description);
      expect(html).toContain(`name="theme" value="${theme.id}"`);
      expect(html).toContain(`aria-describedby="scope-${theme.id}"`);
    }
    expect(state.db!.select().from(interestProfile).all()).toEqual([]);
  });
  it("perfil lista tema criado", async () => {
    state.db!.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("automotivo", "Automotivo");
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toContain('name="theme" value="automotivo"');
    expect(html).toContain("Automotivo");
    expect(html).toContain("Temas base do Orbit e temas criados a partir do seu conteúdo.");
  });
  it("perfil exibe zero neutro para constructor sem peso próprio", async () => {
    state.db!.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run("constructor", "Constructor");
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toMatch(/id="weight-constructor"[^>]*value="0"/);
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

describe("catálogo e reparo em Temas", () => {
  it("lista sementes e temas criados com data, contagem e destinos diferentes da origem", async () => {
    const db = state.db!;
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin, created_at) VALUES (?, ?, 'ai', ?)").run("automotivo", "Automotivo", Date.UTC(2026, 9, 28, 12));
    const source = db.insert(sources).values({ channelId: "channel", name: "Fonte sintética" }).returning().get();
    saveRawItems(db, source.id, [{ platform: "youtube", externalId: "created", title: "Item sintético", text: "Teste", author: "Teste", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: 1, durationSeconds: null }]);
    db.insert(processedItems).values({ rawId: "youtube:created", theme: "automotivo", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Teste", summary: "Teste", isSpam: false, model: "fixture", processedAt: 1 }).run();
    const html = renderToStaticMarkup(await ThemesPage());
    expect(state.requireSession).toHaveBeenCalledOnce();
    expect(html.match(/data-origin="seed"/g)).toHaveLength(8);
    expect(html).toContain("Criado automaticamente em 28/10/2026");
    expect(html).toContain("1 item pessoal disponível");
    expect(html).toContain("Juntar a outro tema");
    expect(html).toContain('name="from" value="automotivo"');
    expect(html).toContain('value="outros"');
    expect(html).not.toContain('<option value="automotivo"');
  });
  it("mostra grupos em observação e avisa ao atingir 40 temas", async () => {
    const db = state.db!;
    const source = db.insert(sources).values({ channelId: "channel", name: "Fonte sintética" }).returning().get();
    for (let index = 0; index < 2; index++) {
      saveRawItems(db, source.id, [{ platform: "youtube", externalId: `proposal-${index}`, title: "Item sintético", text: "Teste", author: "Teste", url: `https://www.youtube.com/watch?v=proposal${index}`, thumbnail: null, publishedAt: 1, durationSeconds: null }]);
      const rawId = `youtube:proposal-${index}`;
      db.insert(processedItems).values({ rawId, theme: "outros", tone: "informativo", language: "pt", type: "educação", score: 80, reason: "Teste", summary: "Teste", isSpam: false, model: "fixture", processedAt: 1 }).run();
      applyThemeProposal(db, rawId, { label: "Automotivo" });
    }
    const before = renderToStaticMarkup(await ThemesPage());
    expect(before).toContain("Em observação");
    expect(before).toContain("Automotivo · 2 de 3 itens");
    expect(before).not.toContain("Limite de 40 temas atingido");
    for (let index = 0; index < 32; index++) db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin) VALUES (?, ?, 'ai')").run(`fixture-${index}`, `Tema sintético ${index}`);
    const html = renderToStaticMarkup(await ThemesPage());
    expect(html).toContain("Limite de 40 temas atingido; junte temas para liberar espaço.");
  });
});
