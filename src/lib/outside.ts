import { and, desc, eq, gte, lte, ne, notInArray, or, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { briefings, feedback, processedItems, rawItems, sources, topics } from "../db/schema";
import { activeItemCondition } from "./store";

const normalized = (theme: string) => theme.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
export function outsideItems(db: OrbitDB) {
  const now = Date.now(), cutoff = now - 48 * 60 * 60_000;
  const latest = db.select({ id: briefings.id }).from(briefings).orderBy(desc(briefings.createdAt), desc(briefings.id)).get();
  const cited = latest ? db.select({ itemIds: topics.itemIds }).from(topics).where(eq(topics.briefingId, latest.id)).all().flatMap(topic => z.array(z.string()).parse(JSON.parse(topic.itemIds))) : [];
  const personal = db.select({ theme: processedItems.theme }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(ne(rawItems.platform, "news"), activeItemCondition(), eq(processedItems.isSpam, false), gte(rawItems.fetchedAt, cutoff))).all();
  const themes = new Set(personal.map(item => normalized(item.theme)));
  const candidates = db.select({ item: rawItems, analysis: processedItems, source: sources.name, reaction: feedback }).from(rawItems).leftJoin(processedItems, eq(processedItems.rawId, rawItems.id)).innerJoin(sources, eq(rawItems.sourceId, sources.id)).leftJoin(feedback, eq(feedback.rawId, rawItems.id)).where(and(eq(rawItems.platform, "news"), activeItemCondition(), or(isNull(processedItems.rawId), eq(processedItems.isSpam, false)), gte(rawItems.newsPublishedAt, cutoff), lte(rawItems.newsPublishedAt, now), cited.length ? notInArray(rawItems.id, cited) : undefined, sql`coalesce(${feedback.seen}, 0) = 0`)).orderBy(desc(processedItems.score), desc(rawItems.newsPublishedAt)).limit(60).all();
  const sorted = candidates.map(row => ({ ...row, novel: !!row.analysis && !themes.has(normalized(row.analysis.theme)), reason: !row.analysis ? "Sem análise de IA: manchete/trecho do portal, ordenado por data entre itens não classificados." : themes.size === 0 ? "Sem amostra pessoal classificada para comparar; esta é uma fonte externa." : themes.has(normalized(row.analysis.theme)) ? "Tema presente na amostra pessoal, com contexto de outro portal." : "Tema diferente dos classificados na amostra recente dos seus feeds." })).sort((a, b) => Number(b.novel) - Number(a.novel) || (b.analysis?.score ?? -1) - (a.analysis?.score ?? -1) || (b.item.newsPublishedAt ?? 0) - (a.item.newsPublishedAt ?? 0));
  const selected: typeof sorted = [], seenThemes = new Set<string>();
  for (const row of sorted) {
    const theme = row.analysis ? normalized(row.analysis.theme) : row.item.id;
    if (seenThemes.has(theme)) continue;
    selected.push(row); seenThemes.add(theme);
    if (selected.length === 3) return selected;
  }
  for (const row of sorted) { if (!selected.some(item => item.item.id === row.item.id)) selected.push(row); if (selected.length === 3) break; }
  return selected;
}
