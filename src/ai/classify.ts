import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { processedItems, rawItems } from "../db/schema";
import type { AIConfig } from "../lib/config";
import { activeItemCondition, dailyUsage, getProfile } from "../lib/store";
import { learnedWeights } from "../lib/feedback";
import { TAXONOMY, themeSchema } from "../lib/taxonomy";
import { estimateRequest, requestWithBudget } from "./request";

const classification = z.object({ id: z.string(), theme: themeSchema, tone: z.string().min(1).max(80), language: z.string().min(1).max(80), type: z.string().min(1).max(80), score: z.number().int().min(0).max(100), reason: z.string().min(1).max(500), summary: z.string().min(1).max(1000), isSpam: z.boolean() });
export function validateClassification(text: string, ids: string[]) {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const result = z.object({ items: z.array(classification) }).parse(JSON.parse(clean));
  const received = result.items.map(item => item.id);
  if (received.length !== ids.length || new Set(received).size !== ids.length || received.some(id => !ids.includes(id))) throw new Error("IDs da classificação não correspondem ao lote.");
  return result.items;
}

export async function classifyPending(db: OrbitDB, config: AIConfig, assertActive: () => void = () => {}, signal?: AbortSignal): Promise<number> {
  const owned = <T>(operation: () => T): T => db.transaction(() => { signal?.throwIfAborted(); assertActive(); return operation(); }, { behavior: "immediate" });
  const profile = getProfile(db);
  const personalProfile = !!profile?.interests.trim();
  const prompt = `${readFileSync(resolve("prompts/classify.md"), "utf8")}\nCatálogo permitido (id = valor de theme; label = nome para leitura):\n${JSON.stringify(TAXONOMY.map(({ id, label, description }) => ({ id, label, description })))}`;
  const payload = (rows: { item: typeof rawItems.$inferSelect }[]) => JSON.stringify({ profile: rows.some(({ item }) => item.platform !== "news") && profile ? { interests: profile.interests, excluded: profile.excluded, learnedThemeWeights: learnedWeights(db) } : undefined, items: rows.map(({ item }) => ({ id: item.id, title: item.title, description: item.text, author: item.author, relevanceScope: item.platform === "news" ? "Importância geral do noticiário externo, sem personalização" : "Relevância para o perfil pessoal", evidence: item.evidence === "news_rss" ? "Título e trecho RSS de um portal externo. Não vem do algoritmo pessoal, nem do artigo integral." : item.evidence === "youtube_home" ? "Somente título/autor visíveis na home. Sem descrição nem transcrição." : item.evidence === "x_for_you" ? "Texto e metadados visíveis no feed Para você do X." : item.evidence === "instagram_feed" ? "Legenda reconhecida e metadados visíveis do feed Instagram. Sem comentários nem stories." : (item.evidence === "valete_feed" || item.evidence === "valete_dom") ? "Trecho textual coletado de post/artigo no feed Valete+, sem HTML ou mídia." : "Somente título e descrição RSS; sem transcrição." })) });
  const estimate = (system: string, user: string) => estimateRequest(config, system, user);
  let processed = 0;
  // shortcut: examina até 50 pendências por lote, paginar a fila quando houver volume maior.
  for (let batch = 0; batch < 10; batch++) {
    assertActive();
    const candidates = db.select({ item: rawItems }).from(rawItems).leftJoin(processedItems, eq(rawItems.id, processedItems.rawId)).where(and(isNull(processedItems.rawId), activeItemCondition(), personalProfile ? undefined : eq(rawItems.platform, "news"))).limit(50).all();
    if (!candidates.length) break;
    const usage = dailyUsage(db);
    const rows: typeof candidates = [];
    for (const candidate of candidates) {
      const trial = estimate(prompt, payload([...rows, candidate]));
      const affordable = usage.tokens + trial.tokens <= config.dailyTokenLimit && (config.dailyUSDLimit === null || (trial.cost !== null && (usage.calls === 0 || usage.cost !== null) && (usage.cost ?? 0) + trial.cost <= config.dailyUSDLimit));
      if (affordable) rows.push(candidate);
      if (rows.length === 5) break;
    }
    if (!rows.length) throw new Error("Limite diário de IA: nenhuma pendência cabe no saldo atual. Itens preservados; confira o limite ou aguarde o próximo dia UTC.");
    const user = payload(rows);
    for (let attempt = 0; attempt < 2; attempt++) {
      const system = attempt === 0 ? prompt : `${prompt}\nA resposta anterior era inválida. Confira JSON, todos os campos, IDs exatos dos itens e theme como ID permitido do catálogo.`;
      const response = await requestWithBudget(db, config, system, user, assertActive, signal);
      let items: z.infer<typeof classification>[];
      try { items = validateClassification(response, rows.map(({ item }) => item.id)); }
      catch { if (attempt === 1) throw new Error("A IA retornou JSON inválido duas vezes. Confira o modelo; nenhuma classificação desse lote foi salva."); else continue; }
      owned(() => {
        for (const { id, ...item } of items) db.insert(processedItems).values({ ...item, rawId: id, model: config.model, processedAt: Date.now() }).onConflictDoNothing().run();
      });
      processed += items.length;
      break;
    }
  }
  return processed;
}
