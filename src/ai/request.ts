import type { OrbitDB } from "../db/index";
import type { AIConfig } from "../lib/config";
import { reserveUsage, settleUsage } from "../lib/store";
import { requestClassification } from "./provider";

export function estimateRequest(config: AIConfig, system: string, user: string) {
  const input = Buffer.byteLength(system + user, "utf8") + 1024;
  return { tokens: input + config.maxOutputTokens, cost: config.inputPrice !== null && config.outputPrice !== null ? (input * config.inputPrice + config.maxOutputTokens * config.outputPrice) / 1_000_000 : null };
}

export async function requestWithBudget(db: OrbitDB, config: AIConfig, system: string, user: string, assertActive: () => void = () => {}, signal?: AbortSignal) {
  const owned = <T>(operation: () => T): T => db.transaction(() => { signal?.throwIfAborted(); assertActive(); return operation(); }, { behavior: "immediate" });
  const estimate = estimateRequest(config, system, user);
  const reservation = owned(() => reserveUsage(db, estimate.tokens, estimate.cost, config.dailyTokenLimit, config.dailyUSDLimit));
  const response = await requestClassification(config, system, user, signal, assertActive);
  owned(() => {
    if (response.inputTokens !== null && response.outputTokens !== null) {
      const cost = config.inputPrice !== null && config.outputPrice !== null ? (response.inputTokens * config.inputPrice + response.outputTokens * config.outputPrice) / 1_000_000 : null;
      settleUsage(db, reservation, response.inputTokens + response.outputTokens, cost);
    }
  });
  return response.text;
}
