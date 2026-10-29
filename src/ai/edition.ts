import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { collectorRuns, editions, rawItems, sources, type EditionContent } from "../db/schema";
import { collectNews } from "../collectors/news";
import { CollectorError } from "../collectors/errors";
import type { RawItem } from "../collectors/types";
import { briefingProblem, type AIConfig } from "../lib/config";
import { dailyUsage, saveRawItems } from "../lib/store";
import { queueEditionPush } from "../lib/push";
import { estimateRequest, requestWithBudget } from "./request";

const editionSchema = z.object({
  introduction: z.string().trim().min(1).max(1500),
  highlights: z.array(z.object({ title: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(2000), context: z.string().trim().min(1).max(1500), relevance: z.string().trim().min(1).max(800), itemIds: z.array(z.string()).min(1).max(12) })).min(1).max(8),
});
export function validateEdition(text: string, ids: string[]): EditionContent {
  const result = editionSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
  const cited = result.highlights.flatMap(highlight => highlight.itemIds);
  if (new Set(cited).size !== cited.length || cited.some(id => !ids.includes(id))) throw new Error("Fontes inválidas na edição.");
  return result;
}
const titleKey = (title: string) => title.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function editionCandidates(db: OrbitDB, edition: typeof editions.$inferSelect) {
  const previous = edition.edition === "morning" ? [] : db.select().from(editions).where(and(eq(editions.status, "published"), edition.edition === "manual" ? gt(editions.windowTo, edition.windowFrom) : and(eq(editions.localDate, edition.localDate), eq(editions.timezone, edition.timezone), inArray(editions.edition, ["morning", "manual"])))).orderBy(desc(editions.id)).all();
  const morningEdition = edition.edition === "afternoon" ? previous.find(row => row.edition === "morning") : undefined;
  const previousIds = previous.flatMap(row => row.itemIds);
  const previousTitles = new Set(previousIds.length ? db.select({ title: rawItems.title }).from(rawItems).where(inArray(rawItems.id, previousIds)).all().map(item => titleKey(item.title)) : []);
  const rows = db.select().from(rawItems).where(and(eq(rawItems.platform, "news"), eq(rawItems.evidence, "news_rss"), gte(rawItems.newsPublishedAt, edition.windowFrom), lte(rawItems.newsPublishedAt, edition.windowTo), sql`exists (select 1 from source_items si join sources s on s.id = si.sourceId where si.rawId = ${rawItems.id} and s.enabled = 1 and s.kind = 'news_rss' and s.platform = 'news')`)).orderBy(desc(rawItems.newsPublishedAt), rawItems.id).limit(200).all();
  const titles = new Set(previousTitles);
  const available = rows.filter(item => {
    const title = titleKey(item.title);
    if (previousIds.includes(item.id) || titles.has(title)) return false;
    titles.add(title); return true;
  });
  // Distribuir a seleção entre origens evita um único RSS ocupar todos os lugares.
  const selected: typeof available = [];
  for (let round = 0; selected.length < 12; round++) {
    let added = false;
    for (const sourceId of new Set(available.map(item => item.sourceId))) {
      const item = available.filter(item => item.sourceId === sourceId)[round];
      if (item) { selected.push(item); added = true; }
      if (selected.length === 12) break;
    }
    if (!added) break;
  }
  return { items: selected, candidateCount: available.length, morning: morningEdition?.content || null };
}

type EditionControl = {
  assertActive?: () => void;
  signal?: AbortSignal;
  collect?: (url: string, name: string, signal?: AbortSignal) => Promise<RawItem[]>;
  now?: number;
  briefingNotice?: string;
};
export async function runEdition(db: OrbitDB, runId: number, config: AIConfig | null, control: EditionControl = {}) {
  const assertActive = () => { control.signal?.throwIfAborted(); control.assertActive?.(); };
  const owned = <T>(operation: () => T): T => db.transaction(() => { assertActive(); return operation(); }, { behavior: "immediate" });
  assertActive();
  const run = db.select().from(collectorRuns).where(eq(collectorRuns.id, runId)).get();
  if (run?.kind !== "edition" || !run.editionId) throw new Error("Execução de edição inválida.");
  const edition = db.select().from(editions).where(eq(editions.id, run.editionId)).get();
  if (!edition) throw new Error("Edição não encontrada.");
  if (["published", "unavailable", "error"].includes(edition.status)) {
    owned(() => db.update(collectorRuns).set({ status: edition.status === "published" ? "completed" : "error", finishedAt: control.now ?? Date.now(), error: edition.notice }).where(eq(collectorRuns.id, runId)).run());
    return;
  }
  const finish = (status: "unavailable" | "error", notice: string) => owned(() => {
    db.update(editions).set({ status, notice }).where(eq(editions.id, edition.id)).run();
    db.update(collectorRuns).set({ status: "error", finishedAt: control.now ?? Date.now(), error: notice }).where(eq(collectorRuns.id, runId)).run();
  });
  if (edition.attempts >= 2) { finish("error", "Esta edição já foi retomada duas vezes. Aguarde a próxima edição; não haverá repetição automática de chamadas."); return; }
  if (edition.edition !== "manual" && (control.now ?? Date.now()) - edition.scheduledAt > 2 * 3600000) { finish("unavailable", "Edição não gerada: o atraso ultrapassou duas horas. Aguarde o próximo horário para não receber um panorama velho como atual."); return; }
  owned(() => db.update(editions).set({ status: "running", attempts: edition.attempts + 1 }).where(eq(editions.id, edition.id)).run());
  const feeds = db.select().from(sources).where(and(eq(sources.enabled, true), eq(sources.kind, "news_rss"), eq(sources.platform, "news"))).all();
  if (!feeds.length) { finish("unavailable", "Adicione e ative fontes RSS públicas em Fontes. O briefing geral não usa a extensão nem presume portais."); return; }
  let failures = 0;
  for (const source of feeds) {
    assertActive();
    if (source.cooldownUntil && source.cooldownUntil > (control.now ?? Date.now())) { failures++; continue; }
    const child = owned(() => db.insert(collectorRuns).values({ sourceId: source.id, parentId: runId, kind: "edition", editionId: edition.id, status: "running", startedAt: control.now ?? Date.now() }).returning().get());
    try {
      assertActive();
      const items = await (control.collect || collectNews)(source.channelId, source.name, control.signal);
      owned(() => {
        const itemCount = saveRawItems(db, source.id, items.filter(item => item.platform === "news" && item.evidence === "news_rss"));
        db.update(collectorRuns).set({ status: "completed", finishedAt: control.now ?? Date.now(), itemCount }).where(eq(collectorRuns.id, child.id)).run();
      });
    } catch (error) {
      assertActive(); failures++;
      owned(() => {
        if (error instanceof CollectorError && error.code === "rate_limited") db.update(sources).set({ cooldownUntil: (control.now ?? Date.now()) + (error.retryAfterMs || 15 * 60000) }).where(eq(sources.id, source.id)).run();
        db.update(collectorRuns).set({ status: error instanceof CollectorError ? error.code : "error", finishedAt: control.now ?? Date.now(), error: "Não foi possível atualizar este RSS público. Confira a URL e a disponibilidade da fonte." }).where(eq(collectorRuns.id, child.id)).run();
      });
    }
  }
  const candidates = editionCandidates(db, edition);
  if (!candidates.items.length) { finish("unavailable", edition.edition === "manual" ? "Nenhuma notícia datada nova nas últimas 24 horas. As edições anteriores continuam no arquivo." : edition.edition === "afternoon" ? "Nenhuma novidade com data válida desde 08h nas fontes configuradas. A edição da manhã continua no arquivo." : "Nenhuma notícia com data válida no período. Confira os RSS; itens antigos, sem data ou posteriores ao fechamento não viram notícias atuais."); return; }
  if (!config) { finish("unavailable", control.briefingNotice || briefingProblem() || "Modelo de briefing indisponível para esta execução."); return; }
  try {
    const prompt = readFileSync(resolve("prompts/edition.md"), "utf8");
    const payload = (items: typeof candidates.items) => JSON.stringify({ edition: edition.edition, timezone: edition.timezone, windowFrom: new Date(edition.windowFrom).toISOString(), windowTo: new Date(edition.windowTo).toISOString(), morning: candidates.morning ? { introduction: candidates.morning.introduction.slice(0, 1000), highlights: candidates.morning.highlights.map(item => ({ title: item.title, summary: item.summary.slice(0, 500) })) } : null, items: items.map(item => ({ id: item.id, title: item.title, description: item.text.slice(0, 6000), author: item.author, publishedAt: new Date(item.newsPublishedAt!).toISOString(), evidence: "Somente título e trecho de RSS público, não reportagem integral" })) });
    const selected: typeof candidates.items = [];
    const usage = dailyUsage(db);
    for (const item of candidates.items) {
      const estimate = estimateRequest(config, prompt, payload([...selected, item]));
      if (usage.tokens + estimate.tokens <= config.dailyTokenLimit && (config.dailyUSDLimit === null || (estimate.cost !== null && (usage.calls === 0 || usage.cost !== null) && (usage.cost ?? 0) + estimate.cost <= config.dailyUSDLimit))) selected.push(item);
    }
    if (!selected.length) throw new Error("Limite diário de IA: a edição geral não cabe no saldo. Nenhum resumo foi publicado.");
    let content: EditionContent | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      assertActive();
      const response = await requestWithBudget(db, config, attempt ? `${prompt}\nResposta anterior inválida: confira JSON, campos e IDs exatos.` : prompt, payload(selected), assertActive, control.signal);
      try { content = validateEdition(response, selected.map(item => item.id)); break; }
      catch { if (attempt === 1) throw new Error("A IA retornou JSON inválido para esta edição duas vezes. Nenhum conteúdo foi publicado."); }
    }
    if (!content) return;
    const valid = content;
    const itemIds = valid.highlights.flatMap(item => item.itemIds);
    owned(() => {
      db.update(editions).set({ status: "published", content: valid, itemIds, generatedAt: control.now ?? Date.now(), model: config.model, sourceCount: itemIds.length, candidateCount: candidates.candidateCount, budgetLimited: selected.length < candidates.items.length, notice: failures ? `${failures} fonte(s) não puderam ser atualizadas. Esta edição usa somente notícias datadas disponíveis no período.` : null }).where(eq(editions.id, edition.id)).run();
      if (edition.edition !== "manual") queueEditionPush(db, edition.id);
      db.update(collectorRuns).set({ status: "completed", finishedAt: control.now ?? Date.now(), itemCount: itemIds.length, error: null }).where(eq(collectorRuns.id, runId)).run();
    });
  } catch (error) {
    assertActive();
    const notice = error instanceof Error && /^(Limite diário|A IA retornou JSON)/.test(error.message) ? error.message : "Não foi possível gerar esta edição. Confira o endpoint e o modelo de briefing. Dados preservados; consumo ambíguo continua reservado.";
    finish("error", notice);
  }
}
