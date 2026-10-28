import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AIConfig } from "../lib/config";

export type AIResponse = { text: string; inputTokens: number | null; outputTokens: number | null };
function tokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function requestClassification(config: AIConfig, system: string, user: string, signal?: AbortSignal, assertActive: () => void = () => {}): Promise<AIResponse> {
  const deadline = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL, timeout: 45_000, maxRetries: 0, logLevel: "off" as const,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      assertActive();
      // SDKs podem importar cabeçalhos do ambiente do agente. Nunca encaminhá-los.
      const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.apiKey}` });
      if (config.protocol === "anthropic") {
        headers.set("x-api-key", config.apiKey);
        const version = new Headers(init?.headers).get("anthropic-version");
        if (version && /^\d{4}-\d{2}-\d{2}$/.test(version)) headers.set("anthropic-version", version);
      }
      return fetch(url, { ...init, headers, signal: deadline, redirect: "error" });
    },
  };
  if (config.protocol === "openai") {
    const client = new OpenAI(options);
    const result = await client.chat.completions.create({ model: config.model, max_tokens: config.maxOutputTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, { signal: deadline });
    if (result.choices[0]?.finish_reason !== "stop") throw new Error("Resposta incompleta ou recusada pelo modelo.");
    return { text: result.choices[0]?.message.content || "", inputTokens: tokens(result.usage?.prompt_tokens), outputTokens: tokens(result.usage?.completion_tokens) };
  }
  // O SDK 1.x usa Bearer; proxies Messages também podem exigir o cabeçalho clássico.
  const client = new Anthropic({ ...options, defaultHeaders: { "x-api-key": config.apiKey }, openTelemetry: false });
  const result = await client.messages.create({ model: config.model, max_tokens: config.maxOutputTokens, system, messages: [{ role: "user", content: user }] }, { signal: deadline });
  if (result.stop_reason !== "end_turn") throw new Error("Resposta incompleta ou recusada pelo modelo.");
  const usage = result.usage;
  const input = tokens(usage?.input_tokens);
  return { text: result.content.filter(block => block.type === "text").map(block => block.text).join("\n"), inputTokens: input === null ? null : input + (tokens(usage?.cache_read_input_tokens) ?? 0) + (tokens(usage?.cache_creation_input_tokens) ?? 0), outputTokens: tokens(usage?.output_tokens) };
}
