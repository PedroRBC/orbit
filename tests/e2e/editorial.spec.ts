import { test, expect } from "./fixtures";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { openDatabase } from "../../src/db/index";
import { briefings, editions, interestProfile, rawItems, sourceItems, sources, topics } from "../../src/db/schema";
import { saveRawItems } from "../../src/lib/store";

test("edição geral tem arquivo privado, período, fontes e leitura móvel sem contaminar o pessoal", async ({ page }) => {
  const db = openDatabase(resolve("test-results/e2e.db"));
  const now = Date.now();
  const source = db.insert(sources).values({ name: "RSS sintético editorial", channelId: "https://editorial.example.com/rss", platform: "news", kind: "news_rss", enabled: false }).onConflictDoUpdate({ target: sources.channelId, set: { enabled: false } }).returning().get();
  saveRawItems(db, source.id, [{ externalId: "editorial-fixture", platform: "news", evidence: "news_rss", title: "Fonte sintética da edição", text: "Conteúdo apenas de teste.", author: "Redação sintética", url: "https://editorial.example.com/noticia", publishedAt: now - 1000, newsPublishedAt: now - 1000, thumbnail: null, durationSeconds: null }]);
  const edition = db.insert(editions).values({ slot: `e2e-${now}`, localDate: "2026-10-28", edition: "morning", timezone: "America/Sao_Paulo", scheduledAt: now, windowFrom: now - 86400000, windowTo: now, createdAt: now, generatedAt: now, status: "published", itemIds: ["news:editorial-fixture"], sourceCount: 1, candidateCount: 1, model: "fixture", content: { introduction: "Este panorama é sintético e existe somente no teste automatizado.", highlights: [{ title: "Acontecimento sintético editorial", summary: "Resumo de teste, não é notícia real.", context: "Contexto sintético com base no trecho.", relevance: "Explicação sintética da relevância.", itemIds: ["news:editorial-fixture"] }] } }).returning().get();
  db.$client.close();
  await page.goto(`/briefings/${edition.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Edição da manhã");
  await expect(page.getByText("America/Sao_Paulo", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Contexto sintético com base no trecho.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Fonte sintética da edição/ })).toHaveAttribute("href", "https://editorial.example.com/noticia");
  await page.screenshot({ path: ".impeccable/review/edition-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/edition-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/briefings");
  await expect(page.getByRole("link", { name: /Edição da manhã/ }).first()).toHaveAttribute("href", `/briefings/${edition.id}`);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Ler edição" })).toHaveAttribute("href", `/briefings/${edition.id}`);
  await expect(page.locator(".recommendation").filter({ hasText: "Acontecimento sintético editorial" })).toHaveCount(0);
  await page.goto("/configuracoes#edicoes");
  await expect(page.getByRole("heading", { name: "Briefings gerais", exact: true })).toBeVisible();
  await expect(page.getByLabel("Fuso das edições")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Notificações/ }).first()).toBeVisible();
  await page.getByLabel("Fuso das edições").fill("invalid");
  await page.getByRole("button", { name: "Salvar agenda dos briefings" }).click();
  await expect(page.locator(".edition-schedule").getByRole("alert")).toContainText("Fuso inválido");
  await page.goto("/temas");
  await expect(page.getByRole("heading", { name: "Temas", exact: true })).toBeVisible();
  await expect(page.locator('.edition-list > section[data-origin="seed"]')).toHaveCount(8);
  await expect(page.locator(".edition-list").getByRole("link", { name: "Tecnologia", exact: true })).toHaveAttribute("href", "/?tema=tecnologia&periodo=all#recommendations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("briefing pessoal identifica o complemento RSS e mantém leitura móvel sem repetir a notícia em Fora da bolha", async ({ page }) => {
  const db = openDatabase(resolve("test-results/e2e.db")), now = Date.now();
  const previous = db.select().from(interestProfile).where(eq(interestProfile.id, 1)).get();
  const source = db.insert(sources).values({ channelId: "synthetic-task9-briefing", name: "Fonte pessoal sintética" }).returning().get();
  const news = db.insert(sources).values({ channelId: "https://task9.example/rss", name: "Portal externo sintético", platform: "news", kind: "news_rss" }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência sintética", excluded: "", updatedAt: now }).onConflictDoUpdate({ target: interestProfile.id, set: { interests: "Ciência sintética" } }).run();
  const ids = ["youtube:task9-personal", "news:task9-external"];
  for (const [sourceId, platform, externalId] of [[source.id, "youtube", "task9-personal"], [news.id, "news", "task9-external"]] as const) saveRawItems(db, sourceId, [{ platform, externalId, evidence: platform === "news" ? "news_rss" : "rss", title: `Manchete sintética ${externalId}`, text: "Trecho somente para teste", author: platform === "news" ? "Portal externo sintético" : "Canal pessoal sintético", url: `https://task9.example/${externalId}`, thumbnail: null, publishedAt: now, newsPublishedAt: platform === "news" ? now : null, durationSeconds: null }]);
  const briefing = db.insert(briefings).values({ snapshot: `task9-${now}`, introduction: "Este é um recorte sintético do feed com complemento externo atribuído.", createdAt: now, windowFrom: now - 86400000, windowTo: now, model: "fixture", sourceCount: 2, candidateCount: 2 }).returning().get();
  const topicId = `task9-${now}`;
  db.insert(topics).values({ id: topicId, briefingId: briefing.id, position: 0, title: "Fato concreto sintético", summary: "Segundo o canal pessoal e o portal externo, o mesmo fato aparece nas duas fontes.", itemIds: JSON.stringify(ids) }).run();
  try {
    await page.goto("/");
    const card = page.getByRole("region", { name: "Seu briefing pessoal", exact: true });
    await expect(card).toContainText("1 item pessoal · 1 notícia externa");
    await expect(card).toContainText("Inclui notícias externas de RSS como complemento; elas não vêm do seu algoritmo.");
    await expect(card.getByText("Inclui fonte externa", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: /Portal externo sintético/ })).toHaveAttribute("href", "https://task9.example/task9-external");
    await expect(page.getByRole("region", { name: "Fora da bolha", exact: true })).not.toContainText("Manchete sintética task9-external");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(card.getByText("Inclui fonte externa", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("synthetic-e2e-api-key-never-render");
  } finally {
    db.delete(topics).where(eq(topics.id, topicId)).run();
    db.delete(briefings).where(eq(briefings.id, briefing.id)).run();
    db.delete(sourceItems).where(inArray(sourceItems.rawId, ids)).run();
    db.delete(rawItems).where(inArray(rawItems.id, ids)).run();
    db.delete(sources).where(inArray(sources.id, [source.id, news.id])).run();
    if (previous) db.update(interestProfile).set(previous).where(eq(interestProfile.id, 1)).run();
    else db.delete(interestProfile).where(eq(interestProfile.id, 1)).run();
    db.$client.close();
  }
});

test("botões manuais usam ações autenticadas e mantêm erro de configuração legível no celular", async ({ page }) => {
  const db = openDatabase(resolve("test-results/e2e.db"));
  const previous = db.select().from(interestProfile).where(eq(interestProfile.id, 1)).get();
  const source = db.insert(sources).values({ channelId: "synthetic-manual-briefing-e2e", name: "Fonte sintética manual", enabled: true }).returning().get();
  db.insert(interestProfile).values({ id: 1, interests: "Ciência sintética", excluded: "", updatedAt: Date.now() }).onConflictDoUpdate({ target: interestProfile.id, set: { interests: "Ciência sintética" } }).run();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    for (const name of ["Atualizar briefing pessoal", "Gerar briefing geral agora"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await button.click();
      const form = button.locator("..");
      await expect(form.getByRole("alert")).toContainText(/Configure AI_(BRIEFING_MODEL|MODEL|BASE_URL)/);
      await expect(button).toBeEnabled();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/briefings");
    const general = page.getByRole("button", { name: "Gerar briefing geral agora", exact: true });
    await general.click();
    await expect(general.locator("..").getByRole("alert")).toContainText(/Configure AI_(BRIEFING_MODEL|MODEL|BASE_URL)/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("body")).not.toContainText("synthetic-e2e-api-key-never-render");
  } finally {
    db.delete(sources).where(eq(sources.id, source.id)).run();
    if (previous) db.update(interestProfile).set(previous).where(eq(interestProfile.id, 1)).run();
    else db.delete(interestProfile).where(eq(interestProfile.id, 1)).run();
    db.$client.close();
  }
});
