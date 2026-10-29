import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openDatabase } from "../src/db/index";
import { briefings, collectorRuns, editions, rawItems, sources, topics } from "../src/db/schema";
import { setSetting } from "../src/lib/store";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof openDatabase> | undefined }));
vi.mock("../src/lib/session", () => ({ requireSession: async () => {} }));
vi.mock("../src/db/index", async importOriginal => ({ ...await importOriginal<typeof import("../src/db/index")>(), getDatabase: () => state.db! }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
import { DailyBriefing } from "../src/app/(app)/briefing";
import { EditionSpotlight } from "../src/app/(app)/edition-spotlight";
import EditionsPage from "../src/app/(app)/briefings/page";
import EditionPage from "../src/app/(app)/briefings/[id]/page";
import StatusPage from "../src/app/(app)/status/page";

beforeEach(() => {
  state.db = openDatabase(":memory:");
  for (const [key, value] of Object.entries({ AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "fixture", AI_MODEL: "classification", AI_BRIEFING_MODEL: "briefing", AI_PROTOCOL: "openai", AI_DAILY_TOKEN_LIMIT: "50000", AI_DAILY_USD_LIMIT: "" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); state.db?.$client.close(); state.db = undefined; });
it.each([false, true])("card pessoal tem botão, aviso e andamento com briefing existente=%s", existing => {
  const db = state.db!;
  if (existing) db.insert(briefings).values({ snapshot: "fixture", introduction: "Briefing sintético preservado", createdAt: Date.now(), windowFrom: 1, windowTo: Date.now(), model: "fixture", sourceCount: 1 }).run();
  setSetting(db, "briefing_notice", "Nada mudou desde o último briefing; nenhuma chamada de IA foi feita.");
  db.insert(collectorRuns).values({ kind: "briefing", status: "queued", startedAt: Date.now() }).run();
  const html = renderToStaticMarkup(createElement(DailyBriefing, { db }));
  expect(html).toContain("Atualizar briefing pessoal");
  expect(html).toContain("Atualizando o briefing pessoal…");
  expect(html).toContain("Nada mudou");
  if (existing) expect(html).toContain("Briefing sintético preservado");
});
it.each([false, true])("card separa contagens, marca tópicos externos ou mostra o motivo: externas=%s", external => {
  const db = state.db!, now = Date.now();
  const source = db.insert(sources).values({ channelId: "fixture", name: "Fonte sintética" }).returning().get();
  const ids = external ? ["youtube:item", "news:external"] : ["youtube:item"];
  for (const id of ids) db.insert(rawItems).values({ id, sourceId: source.id, platform: id.startsWith("news:") ? "news" : "youtube", externalId: id, title: "Fixture", text: "Trecho", author: "Fonte", url: `https://fixture.example/${id}`, fetchedAt: now }).run();
  const briefing = db.insert(briefings).values({ snapshot: "rss-fixture", introduction: "Recorte sintético", createdAt: now, windowFrom: 1, windowTo: now, model: "fixture", sourceCount: ids.length }).returning().get();
  db.insert(topics).values({ id: "rss-topic", briefingId: briefing.id, position: 0, title: "Fato sintético", summary: "Com atribuição às fontes.", itemIds: JSON.stringify(ids) }).run();
  setSetting(db, "briefing_external_notice", "Nenhum RSS externo ativo.");
  const html = renderToStaticMarkup(createElement(DailyBriefing, { db }));
  expect(html).toContain(`1 item pessoal · ${external ? "1 notícia externa" : "0 notícias externas"}`);
  if (external) {
    expect(html).toContain("Inclui notícias externas de RSS como complemento; elas não vêm do seu algoritmo.");
    expect(html).toContain("Inclui fonte externa"); expect(html).not.toContain("Nenhum RSS externo ativo");
    expect(html).toContain("Notícias externas usam data de publicação comprovada nas últimas 24 horas.");
  } else { expect(html).toContain("Nenhum RSS externo ativo"); expect(html).not.toContain("Inclui fonte externa"); }
});
it("sem pessoal o card vazio orienta para briefings gerais e Fora da bolha", () => {
  const db = state.db!;
  setSetting(db, "briefing_notice", "Nenhum item pessoal disponível para este briefing. Consulte os briefings gerais ou Fora da bolha.");
  const html = renderToStaticMarkup(createElement(DailyBriefing, { db }));
  expect(html).toContain('href="/briefings"'); expect(html).toContain('href="#outside-title"'); expect(html).toContain("Fora da bolha");
});
it("home, arquivo e edição mostram manual sem nota de fechamento atrasado", async () => {
  const db = state.db!, now = Date.now();
  const edition = db.insert(editions).values({ slot: "fixture", edition: "manual", localDate: "2026-10-28", timezone: "UTC", scheduledAt: now - 3 * 3600000, windowFrom: now - 86400000, windowTo: now, createdAt: now, generatedAt: now, status: "published", content: { introduction: "Manual sintética", highlights: [] } }).returning().get();
  const spotlight = renderToStaticMarkup(createElement(EditionSpotlight, { db }));
  expect(spotlight).toContain("Gerar briefing geral agora");
  expect(spotlight).toContain("Edição sob demanda");
  expect(spotlight).toContain("Gerada em");
  expect(spotlight).not.toContain("fechamento");
  const archive = renderToStaticMarkup(await EditionsPage({ searchParams: Promise.resolve({}) }));
  expect(archive).toContain("Gerar briefing geral agora");
  const page = renderToStaticMarkup(await EditionPage({ params: Promise.resolve({ id: String(edition.id) }) }));
  expect(page).toContain("Gerada em");
  expect(page).not.toContain("Fechamento:");
  expect(page).not.toContain("A geração ocorreu após o fechamento");
});
it("manual ainda não gerada identifica solicitação, sem inventar data de geração", async () => {
  const db = state.db!, now = Date.now();
  const edition = db.insert(editions).values({ slot: "pending", edition: "manual", localDate: "2026-10-28", timezone: "UTC", scheduledAt: now, windowFrom: now - 86400000, windowTo: now, createdAt: now }).returning().get();
  const page = renderToStaticMarkup(await EditionPage({ params: Promise.resolve({ id: String(edition.id) }) }));
  expect(page).toContain("Solicitada em");
  expect(page).not.toContain("Gerada em");
});
it("status nomeia execução briefing como Briefing pessoal", async () => {
  state.db!.insert(collectorRuns).values({ kind: "briefing", status: "completed", startedAt: Date.now() }).run();
  const html = renderToStaticMarkup(await StatusPage());
  expect(html).toContain("<td>Briefing pessoal</td>");
});
