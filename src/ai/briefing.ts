import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { briefings, processedItems, rawItems, topics } from "../db/schema";
import type { AIConfig } from "../lib/config";
import { learnedWeights, rankingExpression } from "../lib/feedback";
import { activeItemCondition, dailyUsage, getProfile } from "../lib/store";
import { estimateRequest, requestWithBudget } from "./request";

const briefingSchema = z.object({
  introduction: z.string().min(1).max(1500),
  topics: z.array(z.object({ title: z.string().min(1).max(160), summary: z.string().min(1).max(2500), itemIds: z.array(z.string()).min(1).max(24) })).min(1).max(8),
});
export function validateBriefing(text: string, ids: string[]) {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const result = briefingSchema.parse(JSON.parse(clean));
  const received = result.topics.flatMap(topic => topic.itemIds);
  if (received.length !== ids.length || new Set(received).size !== ids.length || received.some(id => !ids.includes(id))) throw new Error("Fontes do briefing não correspondem aos itens recebidos.");
  return result;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function generateBriefing(db: OrbitDB, config: AIConfig, assertActive: () => void = () => {}, signal?: AbortSignal): Promise<boolean> {
  const profile = getProfile(db);
  if (!profile?.interests.trim()) return false;
  const now = Date.now();
  const from = now - 86_400_000;
  const weights = learnedWeights(db);
  const rows = db.select({ item: rawItems, analysis: processedItems }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(activeItemCondition(), ne(rawItems.platform, "news"), eq(processedItems.isSpam, false), gte(rawItems.fetchedAt, from))).orderBy(desc(rankingExpression(weights)), desc(rawItems.publishedAt)).limit(8).all();
  if (!rows.length) return false;
  const prompt = readFileSync(resolve("prompts/briefing.md"), "utf8");
  const items = rows.map(({ item, analysis }) => ({ id: item.id, title: item.title, summary: analysis.summary, description: item.text, author: item.author, platform: item.platform, publishedAt: item.publishedAt }));
  const base = { dayUTC: new Date(now).toISOString().slice(0, 10), profile: { interests: profile.interests, excluded: profile.excluded, learnedThemeWeights: weights } };
  const payload = (selected: typeof items) => JSON.stringify({ ...base, items: selected });
  const usage = dailyUsage(db);
  const selected: typeof items = [];
  for (const item of items) {
    const estimate = estimateRequest(config, prompt, payload([...selected, item]));
    if (usage.tokens + estimate.tokens <= config.dailyTokenLimit && (config.dailyUSDLimit === null || (estimate.cost !== null && (usage.calls === 0 || usage.cost !== null) && (usage.cost ?? 0) + estimate.cost <= config.dailyUSDLimit))) selected.push(item);
  }
  // O cache é consultado antes do saldo: um briefing já pago continua disponível sem nova reserva.
  const fullSnapshot = hash(JSON.stringify({ ...base, items, protocol: config.protocol, endpoint: config.baseURL, model: config.model, prompt }));
  if (db.select().from(briefings).where(eq(briefings.snapshot, fullSnapshot)).get()) return false;
  if (!selected.length) throw new Error("Limite diário de IA: briefing não cabe no saldo atual. O briefing anterior foi preservado.");
  const snapshot = fullSnapshot;
  const user = payload(selected);
  let result: z.infer<typeof briefingSchema> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await requestWithBudget(db, config, attempt === 0 ? prompt : `${prompt}\nA resposta anterior era inválida. Confira JSON e todos os IDs exatos.`, user, assertActive, signal);
    try { result = validateBriefing(text, selected.map(item => item.id)); break; }
    catch { if (attempt === 1) throw new Error("A IA retornou JSON inválido para o briefing duas vezes. O briefing anterior foi preservado."); }
  }
  if (!result) return false;
  const valid = result;
  db.transaction(() => {
    signal?.throwIfAborted(); assertActive();
    const briefing = db.insert(briefings).values({ snapshot, introduction: valid.introduction, createdAt: now, windowFrom: from, windowTo: now, model: config.model, sourceCount: selected.length, candidateCount: items.length, budgetLimited: selected.length < items.length }).returning().get();
    valid.topics.forEach((topic, position) => {
      const id = hash(`${snapshot}:${position}`);
      db.insert(topics).values({ id, briefingId: briefing.id, position, title: topic.title, summary: topic.summary, itemIds: JSON.stringify(topic.itemIds) }).run();
      db.update(processedItems).set({ clusterId: id }).where(inArray(processedItems.rawId, topic.itemIds)).run();
    });
  }, { behavior: "immediate" });
  return true;
}
