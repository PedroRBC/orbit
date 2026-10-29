import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { feedback, interestProfile, processedItems, rawItems } from "../db/schema";
import { getProfile } from "./store";
import { resolveTheme, themeWeightsSchema } from "./taxonomy";

export const feedbackAction = z.enum(["up", "down", "save", "seen", "click"]);
export type FeedbackAction = z.infer<typeof feedbackAction>;
function storedWeights(db: OrbitDB): Record<string, number> {
  const value = getProfile(db)?.weights || "{}";
  return themeWeightsSchema.parse(JSON.parse(value));
}
export function learnedWeights(db: OrbitDB): Record<string, number> {
  return Object.fromEntries(Object.entries(storedWeights(db)).map(([theme, value]) => [theme, Math.max(-20, Math.min(20, value))]));
}
export function adjustedScore(score: number, weight: number) { return Math.max(0, Math.min(100, score + weight * 2)); }
export function rankingExpression(weights: Record<string, number>) {
  const bounded = Object.fromEntries(Object.entries(themeWeightsSchema.parse(weights)).map(([theme, value]) => [theme, Math.max(-20, Math.min(20, value))]));
  return sql<number>`max(0, min(100, ${processedItems.score} + 2 * coalesce((select value from json_each(${JSON.stringify(bounded)}) where key = ${processedItems.theme}), 0)))`;
}

export function applyFeedback(db: OrbitDB, rawId: string, action: FeedbackAction) {
  feedbackAction.parse(action);
  return db.transaction(() => {
    const item = db.select({ theme: processedItems.theme, platform: rawItems.platform }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(eq(processedItems.rawId, rawId)).get();
    if (!item || !getProfile(db)) throw new Error("Item ou perfil não encontrado.");
    const current = db.select().from(feedback).where(eq(feedback.rawId, rawId)).get() ?? { rawId, vote: 0, saved: false, seen: false, clicked: false, updatedAt: 0 };
    const next = { ...current, updatedAt: Date.now() };
    if (action === "up") next.vote = current.vote === 1 ? 0 : 1;
    if (action === "down") next.vote = current.vote === -1 ? 0 : -1;
    if (action === "save") next.saved = !current.saved;
    if (action === "seen") next.seen = !current.seen;
    if (action === "click") next.clicked = true;
    const delta = (next.vote - current.vote) * 3 + Number(next.saved) - Number(current.saved) + Number(next.clicked) - Number(current.clicked);
    db.insert(feedback).values(next).onConflictDoUpdate({ target: feedback.rawId, set: next }).run();
    if (delta && item.platform !== "news") {
      const weights = storedWeights(db);
      const theme = item.theme;
      // Guardar valor não truncado mantém reversibilidade quando o peso visível já chegou ao limite.
      weights[theme] = (Object.hasOwn(weights, theme) ? weights[theme] : 0) + delta;
      db.update(interestProfile).set({ weights: JSON.stringify(weights), updatedAt: Date.now() }).where(eq(interestProfile.id, 1)).run();
    }
    return next;
  }, { behavior: "immediate" });
}

export function updateTopicWeight(db: OrbitDB, theme: string, weight: number) {
  const id = resolveTheme(db, z.string().trim().min(1).max(80).parse(theme));
  if (!id) throw new Error("Escolha um tema do catálogo da taxonomia.");
  z.number().finite().min(-20).max(20).parse(weight);
  db.transaction(() => {
    if (!getProfile(db)) throw new Error("Configure seus interesses primeiro.");
    const weights = storedWeights(db);
    weights[id] = weight;
    db.update(interestProfile).set({ weights: JSON.stringify(weights), updatedAt: Date.now() }).where(eq(interestProfile.id, 1)).run();
  }, { behavior: "immediate" });
}
