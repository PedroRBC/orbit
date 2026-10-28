import { z } from "zod";
import { readAIEnvironment } from "./ai-environment";

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

function number(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  return z.coerce.number().finite().nonnegative().parse(value);
}

export function getAIConfig(env: Record<string, string | undefined> = readAIEnvironment()): AIConfig | null {
  if (!env.AI_BASE_URL?.trim() || !env.AI_API_KEY?.trim() || !env.AI_MODEL?.trim()) return null;
  let url: URL;
  try { url = new URL(env.AI_BASE_URL.trim()); } catch { throw new AIConfigurationError("AI_BASE_URL deve ser uma URL válida."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) {
    throw new AIConfigurationError("AI_BASE_URL precisa usar HTTPS. HTTP só é permitido em localhost; um IP privado não é localhost. Credenciais, query e fragmento na URL não são aceitos.");
  }
  const protocol = z.enum(["openai", "anthropic"]).parse(env.AI_PROTOCOL || "openai");
  const dailyTokenLimit = z.number().int().positive().parse(number(env.AI_DAILY_TOKEN_LIMIT, 50_000));
  const maxOutputTokens = z.number().int().min(256).max(16_000).parse(number(env.AI_MAX_OUTPUT_TOKENS, 3000));
  const inputPrice = number(env.AI_INPUT_USD_PER_MILLION, null);
  const outputPrice = number(env.AI_OUTPUT_USD_PER_MILLION, null);
  const dailyUSDLimit = number(env.AI_DAILY_USD_LIMIT, null);
  if (dailyUSDLimit !== null && (inputPrice === null || outputPrice === null)) throw new AIConfigurationError("Informe os dois preços por milhão de tokens para usar o teto em USD.");
  return { protocol, baseURL: url.toString().replace(/\/$/, ""), apiKey: env.AI_API_KEY.trim(), model: env.AI_MODEL.trim(), maxOutputTokens, dailyTokenLimit, inputPrice, outputPrice, dailyUSDLimit };
}

export function getBriefingConfig(env: Record<string, string | undefined> = readAIEnvironment()): AIConfig | null {
  if (!env.AI_BRIEFING_MODEL?.trim()) return null;
  return getAIConfig({ ...env, AI_MODEL: env.AI_BRIEFING_MODEL, AI_INPUT_USD_PER_MILLION: env.AI_BRIEFING_INPUT_USD_PER_MILLION, AI_OUTPUT_USD_PER_MILLION: env.AI_BRIEFING_OUTPUT_USD_PER_MILLION });
}

export function aiStatus() {
  let tokenLimit = 50_000;
  let costLimit: number | null = null;
  try {
    const env = readAIEnvironment();
    tokenLimit = z.number().int().positive().parse(number(env.AI_DAILY_TOKEN_LIMIT, 50_000));
    costLimit = number(env.AI_DAILY_USD_LIMIT, null);
    const config = getAIConfig(env);
    let briefingReady = false;
    try { briefingReady = !!getBriefingConfig(env); } catch { /* A configuração do briefing é independente. */ }
    return config ? { ready: true, briefingReady, state: "ready" as const, message: "Configuração carregada; conexão será verificada ao analisar", protocol: config.protocol, model: config.model, tokenLimit, costLimit } : { ready: false, briefingReady, state: "missing" as const, message: "Configure URL, chave e modelo no .env (orbit.env no Docker)", protocol: null, model: null, tokenLimit, costLimit };
  } catch (error) {
    return { ready: false, briefingReady: false, state: "invalid" as const, message: error instanceof AIConfigurationError ? error.message : "Configuração inválida. Confira protocolo e limites numéricos no .env (orbit.env no Docker); nenhuma chave é exibida no diagnóstico.", protocol: null, model: null, tokenLimit, costLimit };
  }
}
