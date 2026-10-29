import { and, eq, max } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { briefings, editions, processedItems } from "../db/schema";
import { readAIEnvironment, readEnvironment, type EnvSource } from "./ai-environment";
import { subject } from "./push";

export class AIConfigurationError extends Error {}

export type AIConfig = {
  protocol: "openai" | "anthropic";
  baseURL: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  dailyTokenLimit: number;
  inputPrice: number | null;
  outputPrice: number | null;
  dailyUSDLimit: number | null;
};
export type ModelStatus = { model: string | null; source: EnvSource; state: "carregado" | "ausente" | "inválido" | "incompleto"; reason: string | null; lastSuccessAt: number | null };

function number(name: string, env: Record<string, string | undefined>, fallback: number | null): number | null {
  const value = env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (name === "AI_DAILY_TOKEN_LIMIT" && (!Number.isSafeInteger(parsed) || parsed <= 0)) throw new AIConfigurationError(`${name} inválido: use inteiro positivo.`);
  if (name === "AI_MAX_OUTPUT_TOKENS" && (!Number.isInteger(parsed) || parsed < 256 || parsed > 16_000)) throw new AIConfigurationError(`${name} inválido: use inteiro entre 256 e 16000.`);
  if (!Number.isFinite(parsed) || parsed < 0) throw new AIConfigurationError(`${name} inválido: use número não negativo.`);
  return parsed;
}
function aiURL(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new AIConfigurationError("AI_BASE_URL deve ser uma URL válida."); }
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) throw new AIConfigurationError("AI_BASE_URL precisa usar HTTP ou HTTPS, sem credenciais, query ou fragmento na URL.");
  return url;
}
const configurationMessage = (error: unknown) => error instanceof AIConfigurationError ? error.message : "Configuração inválida; confira as variáveis de IA. Nenhuma chave é exibida no diagnóstico.";

export function getAIConfig(env: Record<string, string | undefined> = readAIEnvironment()): AIConfig | null {
  if (!env.AI_BASE_URL?.trim() || !env.AI_API_KEY?.trim() || !env.AI_MODEL?.trim()) return null;
  const url = aiURL(env.AI_BASE_URL);
  const protocol = env.AI_PROTOCOL || "openai";
  if (protocol !== "openai" && protocol !== "anthropic") throw new AIConfigurationError("AI_PROTOCOL inválido: use openai ou anthropic.");
  const dailyTokenLimit = number("AI_DAILY_TOKEN_LIMIT", env, 50_000)!;
  const maxOutputTokens = number("AI_MAX_OUTPUT_TOKENS", env, 3000)!;
  const inputPrice = number("AI_INPUT_USD_PER_MILLION", env, null);
  const outputPrice = number("AI_OUTPUT_USD_PER_MILLION", env, null);
  const dailyUSDLimit = number("AI_DAILY_USD_LIMIT", env, null);
  if (dailyUSDLimit !== null && inputPrice === null) throw new AIConfigurationError("Informe AI_INPUT_USD_PER_MILLION para usar AI_DAILY_USD_LIMIT.");
  if (dailyUSDLimit !== null && outputPrice === null) throw new AIConfigurationError("Informe AI_OUTPUT_USD_PER_MILLION para usar AI_DAILY_USD_LIMIT.");
  return { protocol, baseURL: url.toString().replace(/\/$/, ""), apiKey: env.AI_API_KEY.trim(), model: env.AI_MODEL.trim(), maxOutputTokens, dailyTokenLimit, inputPrice, outputPrice, dailyUSDLimit };
}

export function getBriefingConfig(env: Record<string, string | undefined> = readAIEnvironment()): AIConfig | null {
  if (!env.AI_BRIEFING_MODEL?.trim()) return null;
  try {
    return getAIConfig({ ...env, AI_MODEL: env.AI_BRIEFING_MODEL, AI_INPUT_USD_PER_MILLION: env.AI_BRIEFING_INPUT_USD_PER_MILLION, AI_OUTPUT_USD_PER_MILLION: env.AI_BRIEFING_OUTPUT_USD_PER_MILLION });
  } catch (error) {
    if (!(error instanceof AIConfigurationError)) throw error;
    throw new AIConfigurationError(error.message.replace(/AI_INPUT_USD_PER_MILLION/g, "AI_BRIEFING_INPUT_USD_PER_MILLION").replace(/AI_OUTPUT_USD_PER_MILLION/g, "AI_BRIEFING_OUTPUT_USD_PER_MILLION"));
  }
}
function missingBriefing(env: Record<string, string | undefined>): string | null {
  for (const key of ["AI_BRIEFING_MODEL", "AI_MODEL", "AI_BASE_URL", "AI_API_KEY"]) if (!env[key]?.trim()) return key;
  if (env.AI_DAILY_USD_LIMIT?.trim()) for (const key of ["AI_BRIEFING_INPUT_USD_PER_MILLION", "AI_BRIEFING_OUTPUT_USD_PER_MILLION"]) if (!env[key]?.trim()) return key;
  return null;
}
export function briefingProblem(env: Record<string, string | undefined> = readAIEnvironment()): string | null {
  const missing = missingBriefing(env);
  if (missing) return `Configure ${missing} para gerar briefings.`;
  try { getAIConfig(env); getBriefingConfig(env); return null; }
  catch (error) { return configurationMessage(error); }
}

export function aiStatus(db?: OrbitDB) {
  const environment = readEnvironment(), { env } = environment;
  let tokenLimit = 50_000, costLimit: number | null = null, config: AIConfig | null = null, problem: string | null = null;
  try {
    tokenLimit = number("AI_DAILY_TOKEN_LIMIT", env, 50_000)!;
    costLimit = number("AI_DAILY_USD_LIMIT", env, null);
    config = getAIConfig(env);
  } catch (error) { problem = configurationMessage(error); }
  const model = env.AI_MODEL?.trim() || null, briefingModel = env.AI_BRIEFING_MODEL?.trim() || null;
  const missing = ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"].find(key => !env[key]?.trim());
  const classification: ModelStatus = { model, source: environment.source("AI_MODEL"), state: !model ? "ausente" : problem ? "inválido" : missing ? "incompleto" : "carregado", reason: problem || (missing ? `Configure ${missing} para analisar itens.` : null), lastSuccessAt: null };
  const briefingReason = briefingProblem(env);
  const briefing: ModelStatus = { model: briefingModel, source: environment.source("AI_BRIEFING_MODEL"), state: !briefingModel ? "ausente" : missingBriefing(env) ? "incompleto" : briefingReason ? "inválido" : "carregado", reason: briefingReason, lastSuccessAt: null };
  if (db) {
    if (model) classification.lastSuccessAt = db.select({ at: max(processedItems.processedAt) }).from(processedItems).where(eq(processedItems.model, model)).get()?.at ?? null;
    if (briefingModel) {
      const personal = db.select({ at: max(briefings.createdAt) }).from(briefings).where(eq(briefings.model, briefingModel)).get()?.at ?? null;
      const general = db.select({ at: max(editions.generatedAt) }).from(editions).where(and(eq(editions.model, briefingModel), eq(editions.status, "published"))).get()?.at ?? null;
      briefing.lastSuccessAt = personal === null ? general : general === null ? personal : Math.max(personal, general);
    }
  }
  let endpoint: { protocol: string; host: string } | null = null;
  try { if (env.AI_BASE_URL?.trim()) { const url = aiURL(env.AI_BASE_URL); endpoint = { protocol: url.protocol, host: url.host }; } } catch { /* O motivo seguro já faz parte do diagnóstico. */ }
  let pushState: "definido" | "ausente" | "inválido" = "ausente";
  if (env.ORBIT_PUSH_SUBJECT?.trim()) { try { subject(env); pushState = "definido"; } catch { pushState = "inválido"; } }
  return {
    ready: !!config, briefingReady: briefingReason === null, state: problem ? "invalid" as const : config ? "ready" as const : "missing" as const,
    message: problem || (config ? "Configuração carregada; conexão será verificada ao analisar" : `Configure ${missing} no .env (orbit.env no Docker)`),
    protocol: config?.protocol ?? null, model: config?.model ?? null, tokenLimit, costLimit,
    file: environment.file, endpoint, apiKey: env.AI_API_KEY?.trim() ? "definida" as const : "ausente" as const,
    classification, briefing, pushContact: { state: pushState, source: environment.source("ORBIT_PUSH_SUBJECT") }, ignoredContainerAI: environment.ignoredContainerAI,
  };
}
