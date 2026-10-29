import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { processedItems, rawItems } from "../db/schema";
import type { AIConfig } from "../lib/config";
import { activeItemCondition, dailyUsage, getProfile } from "../lib/store";
import { learnedWeights } from "../lib/feedback";
import { listThemes, resolveTheme, themeKey } from "../lib/taxonomy";
import { applyThemeProposal, pendingProposalGroups, promoteProposals } from "../lib/themes";
import { estimateRequest, requestWithBudget } from "./request";

const classification = z.object({ id: z.string(), theme: z.string(), newTheme: z.object({ label: z.string(), aliases: z.array(z.string()).max(8).optional() }).optional(), tone: z.string().min(1).max(80), language: z.string().min(1).max(80), type: z.string().min(1).max(80), score: z.number().int().min(0).max(100), reason: z.string().min(1).max(500), summary: z.string().min(1).max(1000), isSpam: z.boolean() });
export function validateClassification(text: string, ids: string[], themeIds: ReadonlySet<string>, lenient?: (theme: string) => string) {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const result = z.object({ items: z.array(classification) }).parse(JSON.parse(clean));
  const received = result.items.map(item => item.id);
  if (received.length !== ids.length || new Set(received).size !== ids.length || received.some(id => !ids.includes(id))) throw new Error("IDs da classificação não correspondem ao lote.");
  return result.items.map(item => {
    const theme = themeIds.has(item.theme) ? item.theme : lenient?.(item.theme);
    if (!theme || !themeIds.has(theme)) throw new Error("Tema fora do catálogo da classificação.");
    return { ...item, theme };
  });
}

export async function classifyPending(db: OrbitDB, config: AIConfig, assertActive: () => void = () => {}, signal?: AbortSignal): Promise<number> {
  const owned = <T>(operation: () => T): T => db.transaction(() => { signal?.throwIfAborted(); assertActive(); return operation(); }, { behavior: "immediate" });
  const profile = getProfile(db);
  const personalProfile = !!profile?.interests.trim();
  const prompt = readFileSync(resolve("prompts/classify.md"), "utf8");
  const estimate = (system: string, user: string) => estimateRequest(config, system, user);
  let processed = 0;
  // shortcut: examina até 50 pendências por lote, paginar a fila quando houver volume maior.
  for (let batch = 0; batch < 10; batch++) {
    assertActive();
    const now = Date.now();
    const candidates = db.select({ item: rawItems }).from(rawItems).leftJoin(processedItems, eq(rawItems.id, processedItems.rawId)).where(and(isNull(processedItems.rawId), activeItemCondition(), or(ne(rawItems.platform, "news"), and(gte(rawItems.newsPublishedAt, now - 48 * 3600000), lte(rawItems.newsPublishedAt, now))), personalProfile ? undefined : eq(rawItems.platform, "news"))).orderBy(desc(rawItems.fetchedAt)).limit(50).all();
    if (!candidates.length) break;
    const catalog = listThemes(db);
    const themes = catalog.map(({ id, label, description, origin }) => origin === "seed" ? { id, label, description } : { id, label });
    const themeIds = new Set(themes.map(theme => theme.id));
    const themeAliases = new Map(catalog.flatMap(theme => [theme.id, theme.label, ...theme.aliases].map(alias => [themeKey(alias), theme.id])));
    const proposedThemes = pendingProposalGroups(db).map(group => group.label);
    const payload = (rows: typeof candidates) => JSON.stringify({ themes, proposedThemes, profile: rows.some(({ item }) => item.platform !== "news") && profile ? { interests: profile.interests, excluded: profile.excluded, learnedThemeWeights: learnedWeights(db) } : undefined, items: rows.map(({ item }) => ({ id: item.id, title: item.title, description: item.platform === "news" ? item.text.slice(0, 1500) : item.text, author: item.author, relevanceScope: item.platform === "news" ? "Importância geral do noticiário externo, sem personalização" : "Relevância para o perfil pessoal", evidence: item.evidence === "news_rss" ? "Título e trecho RSS de um portal externo. Não vem do algoritmo pessoal, nem do artigo integral." : item.evidence === "youtube_home" ? "Somente título/autor visíveis na home. Sem descrição nem transcrição." : item.evidence === "x_for_you" ? "Texto e metadados visíveis no feed Para você do X." : item.evidence === "instagram_feed" ? "Legenda reconhecida e metadados visíveis do feed Instagram. Sem comentários nem stories." : (item.evidence === "valete_feed" || item.evidence === "valete_dom") ? "Trecho textual coletado de post/artigo no feed Valete+, sem HTML ou mídia." : "Somente título e descrição RSS; sem transcrição." })) });
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
      const response = await requestWithBudget(db, config, prompt, user, assertActive, signal);
      let items: z.infer<typeof classification>[];
      try { items = validateClassification(response, rows.map(({ item }) => item.id), themeIds, attempt === 1 ? theme => themeAliases.get(themeKey(theme)) ?? "outros" : undefined); }
      catch { if (attempt === 1) throw new Error("A IA retornou JSON inválido duas vezes. Confira o modelo; nenhuma classificação desse lote foi salva."); else continue; }
      owned(() => {
        const currentThemeIds = new Set(listThemes(db).map(theme => theme.id));
        for (const { id, newTheme, ...item } of items) {
          // Uma junção durante a chamada preserva o rótulo original como alias, não o slug sufixado.
          if (!currentThemeIds.has(item.theme)) item.theme = resolveTheme(db, themes.find(theme => theme.id === item.theme)!.label) ?? "outros";
          if (newTheme && !item.isSpam) item.theme = applyThemeProposal(db, id, newTheme) ?? item.theme;
          db.insert(processedItems).values({ ...item, rawId: id, model: config.model, processedAt: Date.now() }).onConflictDoNothing().run();
        }
        promoteProposals(db);
      });
      processed += items.length;
      break;
    }
  }
  return processed;
}
