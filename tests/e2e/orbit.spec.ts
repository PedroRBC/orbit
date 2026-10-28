import { chromium } from "@playwright/test";
import { test, expect, password, totpSecret } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureJob, claimCaptureJob, revokeExtension } from "../../src/lib/extension";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "../../src/db/index";
import { sources, processedItems, briefings, topics, rawItems, companionJobs, collectorRuns, aiCalls } from "../../src/db/schema";
import { enqueueCollection, saveRawItems } from "../../src/lib/store";
import { sessionCookie, totpCode } from "../../src/lib/auth";
import { normalizeTheme } from "../../src/lib/taxonomy";

test("configura interesses, adiciona fonte e funciona em desktop e celular", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Seu próximo bom conteúdo começa aqui." })).toBeVisible();
  await page.getByRole("link", { name: "Configurar interesses" }).click();
  const borderContrast = await page.getByLabel("Seus interesses").evaluate(element => {
    const luminance = (color: string) => {
      const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const border = luminance(getComputedStyle(element).borderTopColor);
    const surface = luminance(getComputedStyle(element.closest("section")!).backgroundColor);
    return (Math.max(border, surface) + 0.05) / (Math.min(border, surface) + 0.05);
  });
  expect(borderContrast).toBeGreaterThanOrEqual(3);
  await page.getByLabel("Seus interesses").fill("Ciência, tecnologia e educação");
  await page.getByLabel("O que você prefere evitar").fill("Publicidade e sensacionalismo");
  await page.getByRole("button", { name: "Salvar interesses" }).click();
  await expect(page.getByRole("status")).toContainText("Interesses salvos");
  await page.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(page.getByRole("img", { name: "Concluído" })).toBeVisible();
  await page.getByRole("link", { name: "Fontes", exact: true }).click();
  await page.getByLabel("Nome do canal").fill("Canal de teste E2E");
  await page.getByLabel("ID ou URL do canal").fill("UC_x5XG1OV2P6uZZ5FSM9Ttw");
  await page.getByRole("button", { name: "Adicionar canal" }).click();
  await expect(page.getByText("Canal de teste E2E", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Canal de teste E2E", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausar canal Canal de teste E2E" }).click();
  await expect(page.getByRole("button", { name: "Ativar canal Canal de teste E2E" })).toBeVisible();
  await page.getByRole("link", { name: "Status", exact: true }).click();
  await page.getByRole("button", { name: "Atualizar fontes" }).click();
  await expect(page.getByText("Concluída", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Configure URL, chave e modelo no .env (orbit.env no Docker)", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(page.getByLabel("Seus interesses")).toHaveValue("Ciência, tecnologia e educação");
});

test("renderiza ranking e filtros com fixtures sintéticas somente no banco de teste", async ({ page }) => {
  const db = openDatabase(resolve("test-results/e2e.db"));
  const source = db.select().from(sources).where(eq(sources.kind, "youtube_rss")).get()!;
  db.update(sources).set({ enabled: true }).where(eq(sources.id, source.id)).run();
  for (const [index, theme, score] of [[0, "Ciência", 95], [1, "Tecnologia", 60]] as const) {
    const id = `orbitvideo${index}`;
    saveRawItems(db, source.id, [{ platform: "youtube", externalId: id, title: `Fixture sintética ${theme}`, text: "Conteúdo somente para teste automatizado.", author: "Canal de teste", url: `https://www.youtube.com/watch?v=${id}`, thumbnail: null, publishedAt: Date.now(), durationSeconds: null }]);
    db.insert(processedItems).values({ rawId: `youtube:${id}`, theme: normalizeTheme(theme)!, tone: "informativo", language: "pt", type: "educação", score, reason: "Justificativa sintética para verificar a interface.", summary: "Resumo de teste, não uma recomendação real.", isSpam: false, model: "fixture", processedAt: Date.now() }).run();
  }
  const briefing = db.insert(briefings).values({ snapshot: "fixture-only", introduction: "Este briefing sintético serve apenas ao teste automatizado. Não descreve notícias reais.", createdAt: Date.now(), windowFrom: Date.now() - 86400000, windowTo: Date.now(), model: "fixture", sourceCount: 2, candidateCount: 3, budgetLimited: true }).returning().get();
  for (const [index, theme] of [[0, "Ciência"], [1, "Tecnologia"]] as const) db.insert(topics).values({ id: `fixture-topic-${index}`, briefingId: briefing.id, position: index, title: `Tópico sintético ${theme}`, summary: "Resumo de tópico sintético para verificar fontes e leitura. Não é notícia real.", itemIds: JSON.stringify([`youtube:orbitvideo${index}`]) }).run();
  db.$client.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Seu briefing pessoal", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tópico sintético Ciência" })).toBeVisible();
  await expect(page.getByText(/O orçamento reduziu a amostra/)).toBeVisible();
  await expect(page.getByLabel("Fontes de Tópico sintético Ciência").getByRole("link")).toHaveAttribute("href", "https://www.youtube.com/watch?v=orbitvideo0");
  await expect(page.getByRole("article").first()).toContainText("Fixture sintética Ciência");
  await expect(page.getByText("95/100")).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/home-desktop.png", fullPage: true });
  await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("tecnologia");
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("Fixture sintética Tecnologia");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/home-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("salva, marca visto e aprende feedback no Meu perfil", async ({ page }) => {
  await page.goto("/?periodo=all");
  const item = page.getByRole("article").filter({ hasText: "Fixture sintética Ciência" });
  await item.getByRole("button", { name: "Gostei", exact: true }).click();
  await expect(item.getByRole("button", { name: "Gostei", exact: true })).toHaveAttribute("aria-pressed", "true");
  await item.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByRole("combobox", { name: "Lista", exact: true }).selectOption("saved");
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Já vi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Já vi", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Meu perfil", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Um perfil que você entende." })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Peso de Ciência e saúde", exact: true })).toHaveValue("4");
  await page.getByRole("spinbutton", { name: "Peso de Ciência e saúde", exact: true }).fill("7");
  await page.getByRole("button", { name: "Salvar peso de Ciência e saúde" }).click();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Peso de Ciência e saúde", exact: true })).toHaveValue("7");
  await page.getByRole("heading", { name: "Um perfil que você entende." }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".impeccable/review/profile-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/profile-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("ativa e pausa feeds de navegador sem abrir contas reais", async ({ page }) => {
  await page.goto("/fontes");
  await expect(page.getByRole("link", { name: "Abrir Home do YouTube" })).toHaveAttribute("href", "https://www.youtube.com/");
  await page.getByRole("button", { name: "Ativar fonte Home do YouTube", exact: true }).click();
  await page.getByRole("button", { name: "Pausar fonte Home do YouTube", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ativar fonte Home do YouTube", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ativar fonte X · Para você", exact: true }).click();
  await page.getByRole("button", { name: "Pausar fonte X · Para você", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ativar fonte X · Para você", exact: true })).toBeVisible();
  for (const name of ["Instagram · Feed", "Valete+ · Feed"]) {
    await page.getByRole("button", { name: `Ativar fonte ${name}`, exact: true }).click();
    await page.getByRole("button", { name: `Pausar fonte ${name}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Ativar fonte ${name}`, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: ".impeccable/review/sources-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/sources-mobile.png", fullPage: true });
});

test("filtra posts do X e distingue sua evidência de vídeos RSS", async ({ page }) => {
  const db = openDatabase(resolve("test-results/e2e.db"));
  const source = db.insert(sources).values({ channelId: "https://x.com/home", name: "X · Para você", platform: "x", kind: "x_for_you", enabled: true }).onConflictDoUpdate({ target: sources.channelId, set: { enabled: true } }).returning().get();
  saveRawItems(db, source.id, [{ platform: "x", evidence: "x_for_you", externalId: "1234567890123456789", title: "Post sintético do X", text: "Texto somente para teste", author: "Autor sintético", url: "https://x.com/autor/status/1234567890123456789", thumbnail: null, publishedAt: Date.now(), durationSeconds: null, metrics: { likes: "42" } }]);
  db.insert(processedItems).values({ rawId: "x:1234567890123456789", theme: "outros", tone: "informativo", language: "pt", type: "opinião", score: 80, reason: "Justificativa sintética.", summary: "Resumo apenas para teste.", isSpam: false, model: "fixture", processedAt: Date.now() }).run();
  db.$client.close();
  await page.goto("/?plataforma=x&periodo=all");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("Post sintético do X");
  await expect(page.getByRole("article")).toContainText("Baseado no texto visível do post");
  await expect(page.getByRole("article")).toContainText("42 curtidas na fonte");
});

test("pareia uma extensão real e recebe coleta pelo worker sem navegador automatizado de login", async ({ page, request }) => {
  test.setTimeout(60000);
  const directory = mkdtempSync(join(tmpdir(), "orbit-extension-e2e-"));
  const extensionPath = resolve("browser-extension/dist");
  const db = openDatabase(resolve("test-results/e2e.db"));
  const before = db.select().from(sources).all();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let valeteUnavailable = false;
  try {
    context = await chromium.launchPersistentContext(directory, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    await context.route("https://**/*", route => {
      const url = route.request().url();
      if (url === "https://app.valete.org.br/api/post?filter=all" && valeteUnavailable) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      if (url === "https://app.valete.org.br/api/post?filter=all") return route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "extension-post", body: "Texto do feed", Author: { name: "Redação" }, Article: { title: "Consulta real da extensão ao Valete", body: "<p>Texto processado no contexto isolado.</p>" } }]) });
      if (url.startsWith("https://app.valete.org.br/") && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<main><a href="/a/artigo/extension-post">Artigo do feed</a><article><a href="/u/reporter"><p>Redação</p></a><a href="/p/post-visivel/extension-visible"><div class="whitespace-break-spaces">Texto alternativo visível no feed.</div></a></article></main>' });
      if (url.startsWith("https://www.youtube.com/") && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<ytd-rich-item-renderer></ytd-rich-item-renderer><script>window.ytcfg={get:()=>true};window.ytInitialData={contents:{twoColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{content:{richGridRenderer:{contents:[{richItemRenderer:{content:{lockupViewModel:{contentId:"qwerty12345",metadata:{lockupMetadataViewModel:{title:{content:"Coleta da extensão no navegador normal"},metadata:{contentMetadataViewModel:{metadataRows:[{metadataParts:[{text:{content:"Canal sintético"}}]}]}}}}}}}}]}}}}]}}};</script>' });
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(() => {
      const state = globalThis as typeof globalThis & { orbitTestErrors?: string[] }; state.orbitTestErrors = [];
      for (const [object, method] of [[chrome.declarativeNetRequest, "updateSessionRules"], [chrome.scripting, "executeScript"]] as const) {
        const api = object as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        const original = api[method].bind(object);
        api[method] = (...args) => original(...args).catch(error => { state.orbitTestErrors?.push(`${method}: ${error instanceof Error ? error.message : "erro"}`); throw error; });
      }
    });
    const id = new URL(worker.url()).hostname;
    const untouched = await context.newPage();
    await untouched.goto("about:blank");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await page.goto("/conectar");
    await page.getByRole("button", { name: "Gerar código de pareamento" }).click();
    const code = await page.getByLabel("Código temporário").inputValue();
    await popup.getByLabel("Endereço do Orbit").fill("http://127.0.0.1:3101");
    await popup.getByLabel("Código de pareamento").fill(code);
    await popup.getByRole("button", { name: "Conectar ao Orbit" }).click();
    await expect(popup.getByRole("status")).toContainText("Conectada", { timeout: 15000 });
    const permissions = await worker.evaluate(() => chrome.runtime.getManifest().permissions || []);
    expect(permissions).not.toContain("cookies"); expect(permissions).not.toContain("debugger"); expect(permissions).not.toContain("tabs");
    await popup.locator("body").screenshot({ path: ".impeccable/review/extension-popup.png" });
    await page.reload();
    await expect(page.getByText("Extensão online", { exact: true })).toBeVisible();
    await expect(page.getByText("0.3.0", { exact: true })).toBeVisible();
    const bundle = await page.request.get("/conectar/extensao");
    expect(bundle.status()).toBe(200);
    expect(bundle.headers()["content-type"]).toBe("application/zip");
    db.update(sources).set({ enabled: false }).run();
    const source = db.select().from(sources).where(eq(sources.kind, "youtube_home")).get() || db.insert(sources).values({ channelId: "https://www.youtube.com/", name: "Home", kind: "youtube_home", enabled: false }).returning().get();
    db.update(sources).set({ enabled: true }).where(eq(sources.id, source.id)).run();
    enqueueCollection(db);
    await expect.poll(() => db.select().from(companionJobs).where(eq(companionJobs.status, "queued")).get()?.sourceId, { timeout: 10000 }).toBe(source.id);
    await popup.getByRole("button", { name: "Verificar pedidos agora" }).click();
    try { await expect.poll(() => db.select().from(rawItems).where(eq(rawItems.id, "youtube:qwerty12345")).get()?.title, { timeout: 30000 }).toBe("Coleta da extensão no navegador normal"); }
    catch (error) { const diagnostics = await worker.evaluate(() => (globalThis as typeof globalThis & { orbitTestErrors?: string[] }).orbitTestErrors); throw new Error(`Diagnóstico da extensão: ${JSON.stringify(diagnostics)}`, { cause: error }); }
    await expect.poll(() => db.select().from(collectorRuns).orderBy(collectorRuns.id).all().filter(run => run.parentId === null).at(-1)?.status, { timeout: 5000 }).toBe("completed");
    db.update(sources).set({ enabled: false }).run();
    const valete = db.select().from(sources).where(eq(sources.kind, "valete_feed")).get() || db.insert(sources).values({ channelId: "https://app.valete.org.br/", name: "Valete+", kind: "valete_feed", platform: "valete" }).returning().get();
    db.update(sources).set({ enabled: true }).where(eq(sources.id, valete.id)).run();
    enqueueCollection(db);
    await expect.poll(() => db.select().from(companionJobs).where(eq(companionJobs.status, "queued")).get()?.sourceId, { timeout: 10000 }).toBe(valete.id);
    await popup.getByRole("button", { name: "Verificar pedidos agora" }).click();
    await expect.poll(() => db.select().from(rawItems).where(eq(rawItems.id, "valete:extension-post")).get()?.text, { timeout: 30000 }).toBe("Texto processado no contexto isolado.");
    await expect.poll(() => db.select().from(collectorRuns).all().filter(run => run.parentId === null).at(-1)?.status, { timeout: 5000 }).toBe("completed");
    valeteUnavailable = true;
    enqueueCollection(db);
    await expect.poll(() => db.select().from(companionJobs).where(eq(companionJobs.status, "queued")).get()?.sourceId, { timeout: 10000 }).toBe(valete.id);
    await popup.getByRole("button", { name: "Verificar pedidos agora" }).click();
    await expect.poll(() => db.select().from(rawItems).where(eq(rawItems.id, "valete:extension-visible")).get()?.evidence, { timeout: 30000 }).toBe("valete_dom");
    db.update(sources).set({ enabled: false }).where(eq(sources.id, valete.id)).run();
    db.update(sources).set({ enabled: true }).where(eq(sources.id, source.id)).run();
    const parent = db.insert(collectorRuns).values({ status: "running", startedAt: Date.now() }).returning().get();
    const invalidRun = db.insert(collectorRuns).values({ parentId: parent.id, sourceId: source.id, status: "running", startedAt: Date.now() }).returning().get();
    const invalidJob = createCaptureJob(db, source.id, invalidRun.id); claimCaptureJob(db);
    const auth = await worker.evaluate(async () => (await chrome.storage.local.get<{ connection: { token: string } }>("connection")).connection.token);
    const invalidResponse = await request.post("/api/companion/result", { headers: { Origin: `chrome-extension://${id}`, "X-Orbit-Extension-Id": id, Authorization: `Bearer ${auth}` }, data: { id: invalidJob.id, result: { items: [{ platform: "youtube", externalId: "qwerty12345", title: "Inválido", text: "", author: "Canal", url: "not-a-url", thumbnail: null, publishedAt: null, durationSeconds: null }] } } });
    expect(invalidResponse.status()).toBe(400);
    expect(db.select().from(companionJobs).where(eq(companionJobs.id, invalidJob.id)).get()?.status).toBe("error");
    db.update(collectorRuns).set({ status: "error", finishedAt: Date.now() }).where(eq(collectorRuns.id, invalidRun.id)).run();
    db.update(collectorRuns).set({ status: "completed", finishedAt: Date.now() }).where(eq(collectorRuns.id, parent.id)).run();
    expect(untouched.isClosed()).toBe(false);
    expect(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toHaveLength(0);
    await page.screenshot({ path: ".impeccable/review/connect-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".impeccable/review/connect-mobile.png", fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Revogar conexão" }).click();
    await expect(page.getByText("Ainda não pareada", { exact: true })).toBeVisible();
  } finally {
    revokeExtension(db);
    for (const source of before) db.update(sources).set({ enabled: source.enabled }).where(eq(sources.id, source.id)).run();
    await context?.close(); db.$client.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("configura RSS externo, separa Fora da bolha e persiste a agenda pausada", async ({ page }) => {
  await page.goto("/fontes#noticias");
  await page.getByLabel("Nome do portal", { exact: true }).fill("Portal sintético de teste");
  await page.getByLabel("URL do RSS público", { exact: true }).fill("https://news.example.com/rss");
  await page.getByRole("button", { name: "Adicionar RSS", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Portal sintético de teste" })).toBeVisible();
  const db = openDatabase(resolve("test-results/e2e.db"));
  const source = db.select().from(sources).where(eq(sources.channelId, "https://news.example.com/rss")).get()!;
  for (const [index, theme] of [[0, "Saúde"], [1, "Mundo"], [2, "Sem IA"]] as const) {
    saveRawItems(db, source.id, [{ platform: "news", evidence: "news_rss", externalId: `fixture-external-${index}`, title: `Manchete externa sintética ${theme}`, text: "Trecho do portal usado apenas em teste automatizado.", author: "Portal sintético", url: `https://news.example.com/article-${index}`, thumbnail: null, publishedAt: Date.now(), durationSeconds: null }]);
    if (index < 2) db.insert(processedItems).values({ rawId: `news:fixture-external-${index}`, theme: index === 0 ? "ciencia-saude" : "politica-externa", tone: "informativo", language: "pt", type: "notícia", score: 80, reason: "Interesse público sintético", summary: "Resumo apenas para teste, não notícia real.", isSpam: false, model: "fixture", processedAt: Date.now() }).run();
  }
  db.$client.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?periodo=all");
  const external = page.getByRole("region", { name: "Fora da bolha", exact: true });
  await expect(external.getByRole("article")).toHaveCount(3);
  await expect(external).toContainText("Fonte externa · RSS");
  await expect(external).toContainText("sem análise de IA");
  await expect(page.getByRole("region", { name: "Vale a pena ver", exact: true })).not.toContainText("Manchete externa sintética");
  await page.screenshot({ path: ".impeccable/review/final-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/final-mobile.png", fullPage: true });
  await page.goto("/configuracoes");
  await page.getByLabel("Agendamento de coleta ativo", { exact: true }).uncheck();
  await page.getByLabel("Horários (cron)").fill("0 8,14,20 * * *");
  await page.getByLabel("Fuso da coleta").fill("America/Sao_Paulo");
  await page.getByRole("button", { name: "Salvar agenda", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Agenda salva");
  await page.reload();
  await expect(page.getByLabel("Agendamento de coleta ativo", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Fuso da coleta")).toHaveValue("America/Sao_Paulo");
  const costDB = openDatabase(resolve("test-results/e2e.db"));
  const call = costDB.insert(aiCalls).values({ day: new Date().toISOString().slice(0, 10), tokens: 50000, cost: null, status: "reserved", createdAt: Date.now() }).returning().get();
  try {
    await page.goto("/status");
    await expect(page.getByRole("status")).toContainText("Teto diário atingido");
    await expect(page.getByLabel("Consumo do teto diário em tokens")).toHaveAttribute("value", "50000");
    await expect(page.getByText("Indisponível — sem preços ou consumo confirmado", { exact: true })).toBeVisible();
  } finally { costDB.delete(aiCalls).where(eq(aiCalls.id, call.id)).run(); costDB.$client.close(); }
});

test("recusa submissão cross-origin e host de DNS rebinding", async ({ request }) => {
  const rebinding = await request.get("/", { headers: { Host: "attacker.example" } });
  expect(rebinding.status()).toBe(403);
  const cross = await request.post("/", { headers: { Origin: "https://attacker.example" }, data: {} });
  expect(cross.status()).toBe(403);
  const forgedExtension = await request.post("/api/extension/pair", { headers: { Origin: "https://attacker.example", "X-Orbit-Extension-Id": "a".repeat(32) }, data: { code: "invalid" } });
  expect(forgedExtension.status()).toBe(403);
  const missingToken = await request.post("/api/companion/poll", { headers: { Origin: `chrome-extension://${"a".repeat(32)}`, "X-Orbit-Extension-Id": "a".repeat(32) }, data: {} });
  expect(missingToken.status()).toBe(401);
});

test("sem sessão, páginas levam ao login e ações e downloads são recusados", async ({ request }) => {
  const home = await request.get("/status", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toMatch(/\/login\?next=%2Fstatus$/);
  expect((await request.get("/conectar/extensao", { maxRedirects: 0 })).status()).toBe(307);
  expect((await request.post("/", { headers: { Origin: "http://127.0.0.1:3101" }, data: {} })).status()).toBe(401);
  const forged = await request.get("/status", { maxRedirects: 0, headers: { Cookie: `${sessionCookie}=inventado` } });
  expect(forged.status()).toBe(307);
  expect(forged.headers().location).toMatch(/\/login\?next=%2Fstatus$/);
  expect((await request.get("/api/health")).status()).toBe(200);
  // Reprodução da revisão: cookie inventado não pode receber o payload RSC da página.
  const rsc = await request.get("/perfil?_rsc=1", { maxRedirects: 0, headers: { RSC: "1", Cookie: `${sessionCookie}=inventado` } });
  expect(rsc.status()).toBe(307);
  expect(await rsc.text()).not.toContain("Ciência, tecnologia");
});

test("após o login, next com tab ou barra dupla não sai do Orbit", async ({ page }) => {
  for (const next of ["%2F%09%2Fevil.example", "%2F%2Fevil.example", "%2F%5Cevil.example"]) {
    const response = await page.request.get(`/login?next=${next}`, { maxRedirects: 0 });
    expect(`${next} ${response.status()} ${new URL(response.headers().location, "http://127.0.0.1:3101").href}`).toBe(`${next} 307 http://127.0.0.1:3101/`);
  }
});

test("entra com senha e código do autenticador e sai do dispositivo", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/status");
    await expect(page).toHaveURL(/\/login\?next=%2Fstatus$/);
    await expect(page.getByRole("heading", { name: "Entrar no Orbit" })).toBeVisible();
    await page.getByLabel("Senha").fill(password);
    await page.getByLabel("Código do autenticador").fill("000000");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Senha ou código inválido.")).toBeVisible();
    // Server Actions limpam o formulário após cada envio: a senha é digitada de novo.
    await page.getByLabel("Senha").fill(password);
    await page.getByLabel("Código do autenticador").fill(totpCode(totpSecret, Math.floor(Date.now() / 30_000)));
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Tudo às claras." })).toBeVisible();
    expect((await context.cookies()).find(cookie => cookie.name === sessionCookie)).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/configuracoes");
    await page.getByRole("button", { name: "Sair deste dispositivo" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/status");
    await expect(page).toHaveURL(/\/login\?next=%2Fstatus$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".impeccable/review/login-mobile.png", fullPage: true });
  } finally { await context.close(); }
});

test("PWA instalável: manifest, ícones e service worker públicos e sem dados pessoais", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ short_name: "Orbit", start_url: "/", scope: "/", display: "standalone", lang: "pt-BR" });
  expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`)).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
  for (const path of [...manifest.icons.map((icon: { src: string }) => icon.src), "/apple-icon.png"]) {
    const icon = await request.get(path, { maxRedirects: 0 });
    expect(`${path} ${icon.status()} ${icon.headers()["content-type"]}`).toBe(`${path} 200 image/png`);
  }
  const worker = await request.get("/sw.js", { maxRedirects: 0 });
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/offline.html", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get("/perfil", { maxRedirects: 0 })).status()).toBe(307);
});

test("guarda só a página offline, avisa a desconexão e não reenvia nada", async ({ page, context }) => {
  await page.goto("/status");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(entry => new URL(entry.url).pathname)))).flat());
  expect(cached).toEqual(["/offline.html"]);
  await context.setOffline(true);
  await expect(page.getByText("Sem conexão com o Orbit.")).toBeVisible();
  await page.goto("/perfil").catch(() => {});
  await expect(page.getByRole("heading", { name: "Sem conexão com o Orbit" })).toBeVisible();
  await context.setOffline(false);
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Um perfil que você entende." })).toBeVisible();
  await expect(page.getByText("Sem conexão com o Orbit.")).toBeHidden();
});

test("controles têm alvo de toque de pelo menos 24 px no celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const small: string[] = [];
  for (const path of ["/", "/fontes", "/perfil", "/status", "/configuracoes", "/conectar"]) {
    await page.goto(path);
    // Links dentro de frases são exceção do WCAG 2.5.8.
    small.push(...await page.evaluate(route => [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")]
      .filter(element => element.offsetParent !== null && !element.closest("p, li, dd, td"))
      .map(element => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 24 || box.height < 24)
      .map(({ element, box }) => `${route} ${element.tagName} "${(element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`), path));
  }
  expect(small).toEqual([]);
});
