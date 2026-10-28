import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { getAIConfig, getBriefingConfig } from "../src/lib/config";
import { requestClassification } from "../src/ai/provider";
import { validateClassification } from "../src/ai/classify";
import { THEME_IDS } from "../src/lib/taxonomy";

const servers: Server[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });
const result = { items: [{ id: "youtube:abcdefghijk", theme: "ciencia-saude", tone: "informativo", language: "pt", type: "educação", score: 84, reason: "Combina com seus interesses.", summary: "Descrição da aula.", isSpam: false }] };

async function endpoint(protocol: "openai" | "anthropic") {
  const requests: { path: string; body: Record<string, unknown>; key: string | undefined; auth: string | undefined; inherited: string | undefined }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, body: JSON.parse(body), key: protocol === "openai" ? req.headers.authorization : req.headers["x-api-key"] as string, auth: req.headers.authorization, inherited: req.headers["x-private-key"] as string });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(protocol === "openai" ? { id: "chat-1", object: "chat.completion", created: 1, model: "custom-model", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } } : { id: "msg-1", type: "message", role: "assistant", model: "custom-model", content: [{ type: "text", text: JSON.stringify(result) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 80 } }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta");
  return { url: `http://127.0.0.1:${address.port}${protocol === "openai" ? "/v1" : ""}`, requests };
}

describe("configuração e protocolos", () => {
  it("não habilita IA sem URL, chave e modelo", () => {
    expect(getAIConfig({})).toBeNull();
  });
  it.each([
    "http://192.168.1.3:8317/v1", "http://10.0.0.3:8317/v1", "http://172.17.0.1:8317/v1",
    "http://[fd00::3]:8317/v1", "http://cliproxyapi:8317/v1", "http://proxy.lan:8317/v1",
    "http://example.com/v1", "https://example.com/v1",
  ])("aceita o endpoint configurado %s para classificação e briefing", baseURL => {
    for (const protocol of ["openai", "anthropic"]) {
      const env = { AI_PROTOCOL: protocol, AI_BASE_URL: baseURL, AI_API_KEY: "test-key", AI_MODEL: "custom-model", AI_BRIEFING_MODEL: "briefing-model" };
      expect(getAIConfig(env)).toMatchObject({ protocol, baseURL, model: "custom-model" });
      expect(getBriefingConfig(env)).toMatchObject({ protocol, baseURL, model: "briefing-model" });
    }
  });
  it.each([
    "https://user:pass@example.com", "http://user:pass@192.168.1.3:8317/v1",
    "http://proxy.lan/v1?key=secret", "https://example.com/v1#fragment",
    "ftp://proxy.lan/v1", "file:///tmp/model", "not-a-url",
  ])("rejeita protocolo inválido, credenciais, query ou fragmento: %s", baseURL => {
    expect(() => getAIConfig({ AI_BASE_URL: baseURL, AI_API_KEY: "secret", AI_MODEL: "model" })).toThrow();
  });
  for (const protocol of ["openai", "anthropic"] as const) {
    it(`usa endpoint/modelo/chave customizados no protocolo ${protocol}`, async () => {
      vi.stubEnv(protocol === "openai" ? "OPENAI_CUSTOM_HEADERS" : "ANTHROPIC_CUSTOM_HEADERS", "Authorization: Bearer inherited-secret\nx-private-key: another-secret");
      const local = await endpoint(protocol);
      const config = getAIConfig({ AI_PROTOCOL: protocol, AI_BASE_URL: local.url, AI_API_KEY: "test-key", AI_MODEL: "custom-model" })!;
      const response = await requestClassification(config, "Retorne JSON", "dados");
      expect(JSON.parse(response.text)).toEqual(result);
      expect(response).toMatchObject({ inputTokens: 100, outputTokens: 80 });
      expect(local.requests[0].path).toBe(protocol === "openai" ? "/v1/chat/completions" : "/v1/messages");
      expect(local.requests[0].body.model).toBe("custom-model");
      expect(local.requests[0].key).toBe(protocol === "openai" ? "Bearer test-key" : "test-key");
      expect(local.requests[0].auth).toBe("Bearer test-key");
      expect(local.requests[0].inherited).toBeUndefined();
    });
    it(`não segue redirecionamentos HTTP nem encaminha a chave no protocolo ${protocol}`, async () => {
      const target = await endpoint(protocol);
      const redirect = createServer((_req, res) => { res.writeHead(307, { Location: target.url }); res.end(); });
      servers.push(redirect);
      await new Promise<void>(resolve => redirect.listen(0, "127.0.0.1", resolve));
      const address = redirect.address();
      if (!address || typeof address === "string") throw new Error("Sem porta");
      const config = getAIConfig({ AI_PROTOCOL: protocol, AI_BASE_URL: `http://127.0.0.1:${address.port}`, AI_API_KEY: "test-key", AI_MODEL: "custom-model" })!;
      await expect(requestClassification(config, "JSON", "dados")).rejects.toThrow();
      expect(target.requests).toEqual([]);
    });
  }
  it("cancela a leitura do corpo Anthropic quando o sinal expira", async () => {
    let closeBody: (() => void) | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      const body = new ReadableStream({ start(controller) { closeBody = () => controller.error(new Error("Encerrar teste")); init.signal?.addEventListener("abort", () => controller.error(new Error("Abortado")), { once: true }); } });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    const config = getAIConfig({ AI_PROTOCOL: "anthropic", AI_BASE_URL: "https://example.com", AI_API_KEY: "test-key", AI_MODEL: "custom" })!;
    const pending = requestClassification(config, "JSON", "dados", AbortSignal.timeout(30)).then(() => "resolved", () => "aborted");
    const outcome = await Promise.race([pending, new Promise<string>(resolve => setTimeout(() => resolve("still-reading"), 100))]);
    closeBody?.();
    expect(outcome).toBe("aborted");
  });
  it("aceita apenas IDs do catálogo como tema da IA, não aliases ou rótulos livres", () => {
    for (const theme of THEME_IDS) expect(validateClassification(JSON.stringify({ items: [{ ...result.items[0], theme }] }), [result.items[0].id])[0].theme).toBe(theme);
    for (const theme of ["Ciência", "Technology", "Política brasileira", "novo-assunto", "__proto__", "", "TECNOLOGIA"]) {
      expect(() => validateClassification(JSON.stringify({ items: [{ ...result.items[0], theme }] }), [result.items[0].id])).toThrow();
    }
  });
  it("rejeita respostas incompletas, repetidas e IDs não solicitados", () => {
    expect(validateClassification(JSON.stringify(result), ["youtube:abcdefghijk"])).toEqual(result.items);
    expect(() => validateClassification(JSON.stringify(result), ["outro"])).toThrow();
    expect(() => validateClassification(JSON.stringify({ items: [result.items[0], result.items[0]] }), ["youtube:abcdefghijk"])).toThrow();
    expect(() => validateClassification('{"items":[]}', ["youtube:abcdefghijk"])).toThrow();
  });
});
