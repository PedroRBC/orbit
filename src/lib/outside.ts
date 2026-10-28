import { and, desc, eq, gte, ne, or, isNull, sql } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { feedback, processedItems, rawItems, sources } from "../db/schema";
import { activeItemCondition } from "./store";

const normalized = (theme: string) => theme.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
export function outsideItems(db: OrbitDB) {
  const cutoff = Date.now() - 48 * 60 * 60_000;
  const personal = db.select({ theme: processedItems.theme }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(ne(rawItems.platform, "news"), activeItemCondition(), eq(processedItems.isSpam, false), gte(rawItems.fetchedAt, cutoff))).all();
  const themes = new Set(personal.map(item => normalized(item.theme)));
  const candidates = db.select({ item: rawItems, analysis: processedItems, source: sources.name, reaction: feedback }).from(rawItems).leftJoin(processedItems, eq(processedItems.rawId, rawItems.id)).innerJoin(sources, eq(rawItems.sourceId, sources.id)).leftJoin(feedback, eq(feedback.rawId, rawItems.id)).where(and(eq(rawItems.platform, "news"), activeItemCondition(), gte(rawItems.fetchedAt, cutoff), or(isNull(processedItems.rawId), eq(processedItems.isSpam, false)), gte(sql<number>`coalesce(${rawItems.publishedAt}, ${rawItems.fetchedAt})`, cutoff), sql`coalesce(${feedback.seen}, 0) = 0`)).orderBy(desc(processedItems.score), desc(rawItems.publishedAt)).limit(60).all();
  const sorted = candidates.map(row => ({ ...row, novel: !!row.analysis && !themes.has(normalized(row.analysis.theme)), reason: !row.analysis ? "Sem análise de IA: manchete/trecho do portal, ordenado por data entre itens não classificados." : themes.size === 0 ? "Sem amostra pessoal classificada para comparar; esta é uma fonte externa." : themes.has(normalized(row.analysis.theme)) ? "Tema presente na amostra pessoal, com contexto de outro portal." : "Tema diferente dos classificados na amostra recente dos seus feeds." })).sort((a, b) => Number(b.novel) - Number(a.novel) || (b.analysis?.score ?? -1) - (a.analysis?.score ?? -1) || (b.item.publishedAt ?? b.item.fetchedAt) - (a.item.publishedAt ?? a.item.fetchedAt));
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
