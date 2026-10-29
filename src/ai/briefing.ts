import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { briefings, processedItems, rawItems, sources, topics } from "../db/schema";
import type { AIConfig } from "../lib/config";
import { learnedWeights, rankingExpression } from "../lib/feedback";
import { activeItemCondition, dailyUsage, getProfile, setSetting } from "../lib/store";
import { estimateRequest, requestWithBudget } from "./request";

const briefingSchema = z.object({
  introduction: z.string().min(1).max(1500),
  topics: z.array(z.object({ title: z.string().min(1).max(160), summary: z.string().min(1).max(2500), itemIds: z.array(z.string()).min(1).max(24) })).min(1).max(8),
});
export function validateBriefing(text: string, ids: string[], optionalIds: string[] = []) {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const result = briefingSchema.parse(JSON.parse(clean));
  const received = result.topics.flatMap(topic => topic.itemIds);
  if (new Set(received).size !== received.length || ids.some(id => !received.includes(id)) || received.some(id => !ids.includes(id) && !optionalIds.includes(id))) throw new Error("Fontes do briefing não correspondem aos itens recebidos.");
  return result;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const titleKey = (title: string) => title.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type BriefingOutcome = "created" | "unchanged" | "empty" | "no_profile" | "no_personal";
export async function generateBriefing(db: OrbitDB, config: AIConfig, assertActive: () => void = () => {}, signal?: AbortSignal): Promise<BriefingOutcome> {
  signal?.throwIfAborted(); assertActive();
  const profile = getProfile(db);
  if (!profile?.interests.trim()) return "no_profile";
  const now = Date.now();
  const from = now - 86_400_000;
  const weights = learnedWeights(db);
  const rows = db.select({ item: rawItems, analysis: processedItems }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(activeItemCondition(), ne(rawItems.platform, "news"), eq(processedItems.isSpam, false), gte(rawItems.fetchedAt, from))).orderBy(desc(rankingExpression(weights)), desc(rawItems.publishedAt)).limit(8).all();
  if (!rows.length) return "no_personal";
  const externalCondition = and(eq(rawItems.platform, "news"), eq(rawItems.evidence, "news_rss"), activeItemCondition(), gte(rawItems.newsPublishedAt, from), lte(rawItems.newsPublishedAt, now));
  const externalRows = db.select({ item: rawItems, analysis: processedItems }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(externalCondition, eq(processedItems.isSpam, false))).orderBy(desc(processedItems.score), desc(rawItems.newsPublishedAt)).limit(30).all();
  const titles = new Set<string>();
  const unique = externalRows.filter(({ item }) => {
    const title = titleKey(item.title);
    if (titles.has(title)) return false;
    titles.add(title); return true;
  });
  const external: typeof unique = [], seenSources = new Set<number>();
  for (const row of unique) {
    if (!seenSources.has(row.item.sourceId)) { external.push(row); seenSources.add(row.item.sourceId); }
    if (external.length === 3) break;
  }
  for (const row of unique) {
    if (external.length === 3) break;
    if (!external.includes(row)) external.push(row);
  }
  const prompt = readFileSync(resolve("prompts/briefing.md"), "utf8");
  const items = [...rows, ...external].map(({ item, analysis }) => ({ id: item.id, title: item.title, summary: analysis.summary, description: item.platform === "news" ? item.text.slice(0, 1500) : item.text, author: item.author, platform: item.platform, publishedAt: item.platform === "news" ? item.newsPublishedAt : item.publishedAt, ...(item.platform === "news" ? { external: true } : {}) }));
  const base = { profile: { interests: profile.interests, excluded: profile.excluded, learnedThemeWeights: weights } };
  const payload = (selected: typeof items) => JSON.stringify({ ...base, dayUTC: new Date(now).toISOString().slice(0, 10), items: selected });
  const usage = dailyUsage(db);
  const selected: typeof items = [];
  for (const item of items) {
    const estimate = estimateRequest(config, prompt, payload([...selected, item]));
    if (usage.tokens + estimate.tokens <= config.dailyTokenLimit && (config.dailyUSDLimit === null || (estimate.cost !== null && (usage.calls === 0 || usage.cost !== null) && (usage.cost ?? 0) + estimate.cost <= config.dailyUSDLimit))) selected.push(item);
  }
  // O cache é consultado antes do saldo: um briefing já pago continua disponível sem nova reserva.
  const fullSnapshot = hash(JSON.stringify({ ...base, items, protocol: config.protocol, endpoint: config.baseURL, model: config.model, prompt }));
  if (db.select().from(briefings).where(eq(briefings.snapshot, fullSnapshot)).get()) return "unchanged";
  if (!selected.length) throw new Error("Limite diário de IA: briefing não cabe no saldo atual. O briefing anterior foi preservado.");
  if (!selected.some(item => !item.external)) return "no_personal";
  const snapshot = fullSnapshot;
  const user = payload(selected);
  let result: z.infer<typeof briefingSchema> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await requestWithBudget(db, config, attempt === 0 ? prompt : `${prompt}\nA resposta anterior era inválida. Confira JSON e todos os IDs exatos.`, user, assertActive, signal);
    try { result = validateBriefing(text, selected.filter(item => !item.external).map(item => item.id), selected.filter(item => item.external).map(item => item.id)); break; }
    catch (error) {
      if (attempt === 1) throw new Error(error instanceof Error && error.message.startsWith("Fontes do briefing") ? "A IA não citou corretamente as fontes do briefing duas vezes. O briefing anterior foi preservado." : "A IA retornou JSON inválido para o briefing duas vezes. O briefing anterior foi preservado.");
    }
  }
  if (!result) throw new Error("A IA retornou JSON inválido para o briefing.");
  const valid = result;
  db.transaction(() => {
    signal?.throwIfAborted(); assertActive();
    const cited = valid.topics.flatMap(topic => topic.itemIds);
    let externalNotice = "";
    if (!selected.some(item => item.external && cited.includes(item.id))) {
      if (!db.select({ id: sources.id }).from(sources).where(and(eq(sources.platform, "news"), eq(sources.kind, "news_rss"), eq(sources.enabled, true))).get()) externalNotice = "Nenhum RSS externo ativo.";
      else if (!db.select({ id: rawItems.id }).from(rawItems).where(externalCondition).get()) externalNotice = "Nenhuma notícia RSS com data de publicação comprovada nas últimas 24 horas.";
      else if (db.select({ id: rawItems.id }).from(rawItems).leftJoin(processedItems, eq(processedItems.rawId, rawItems.id)).where(and(externalCondition, isNull(processedItems.rawId))).get()) externalNotice = "Notícias RSS aguardando análise.";
      else externalNotice = "O modelo não citou nenhuma notícia externa.";
    }
    setSetting(db, "briefing_external_notice", externalNotice);
    const briefing = db.insert(briefings).values({ snapshot, introduction: valid.introduction, createdAt: now, windowFrom: from, windowTo: now, model: config.model, sourceCount: cited.length, candidateCount: items.length, budgetLimited: selected.length < items.length }).returning().get();
    valid.topics.forEach((topic, position) => {
      const id = hash(`${snapshot}:${position}`);
      db.insert(topics).values({ id, briefingId: briefing.id, position, title: topic.title, summary: topic.summary, itemIds: JSON.stringify(topic.itemIds) }).run();
      db.update(processedItems).set({ clusterId: id }).where(inArray(processedItems.rawId, topic.itemIds)).run();
    });
  }, { behavior: "immediate" });
  return "created";
}
