import type { Page } from "playwright";
import { z } from "zod";
import { CollectorError, retryAfterMs } from "./errors";
import type { RawItem } from "./types";
import { assertFeedAccess } from "./readers";
import { readValeteDOM } from "./valete-dom";
import { valeteSelectors } from "./selectors/valete";

const author = z.object({ name: z.string().nullish() }).nullish();
const post = z.object({ id: z.string().min(1).max(200), body: z.string().nullish(), publishedAt: z.string().nullish(), createdAt: z.string().nullish(), Author: author, Article: z.object({ id: z.string().nullish(), title: z.string().nullish(), body: z.string().nullish(), subtitle: z.string().nullish(), bylineName: z.string().nullish(), BylineAuthor: author, Author: author, imageUri: z.string().nullish() }).nullish(), OriginalPost: z.unknown().optional(), likes: z.number().nonnegative().nullish(), comments: z.number().nonnegative().nullish() });

export async function readValeteFeed(page: Page): Promise<RawItem[]> {
  const response = await page.evaluate(async () => {
    try {
      const response = await fetch(new URL("/api/post?filter=all", location.origin).href, { credentials: "include", redirect: "manual", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) return { error: "rate" as const, data: null, retryAfter: response.headers.get("retry-after") };
      if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) return { error: "login" as const, data: null };
      if (!response.ok) return { error: response.status >= 500 ? "http" as const : "format" as const, data: null };
      if (!response.headers.get("content-type")?.includes("application/json")) return { error: "login" as const, data: null };
      const reader = response.body?.getReader();
      if (!reader) return { error: "format" as const, data: null };
      const decoder = new TextDecoder();
      let size = 0, body = "";
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) return { error: "format" as const, data: null };
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        return { error: null, data: JSON.parse(body) as unknown };
      } finally { await reader.cancel(); }
    } catch (error) {
      if (error instanceof SyntaxError) return { error: "format" as const, data: null };
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return { error: "timeout" as const, data: null };
      return { error: "http" as const, data: null };
    }
  });
  if (response.error === "rate") throw new CollectorError("rate_limited", "Valete+ pediu redução de frequência. A fonte ficará em pausa pelo Retry-After.", retryAfterMs(response.retryAfter));
  if (response.error === "login") throw new CollectorError("login_required", "Valete+ exige sessão válida no app. Faça login manual; HTML e redirecionamentos não são tratados como dados.");
  if (response.error === "timeout" || response.error === "http") { await assertFeedAccess(page, "valete"); const visible = await readValeteDOM(page); if (visible.length) return visible; }
  if (response.error === "timeout") throw new CollectorError("source_timeout", "Valete+ excedeu o prazo de 15 segundos da consulta. A sessão não foi invalidada; tente novamente mais tarde.");
  if (response.error === "http") throw new CollectorError("source_http_error", "Valete+ não respondeu no prazo ou retornou erro HTTP. Tente novamente mais tarde; não é necessário presumir sessão expirada.");
  if (response.error) throw new CollectorError("layout_changed", "A API Valete+ não retornou JSON válido dentro do limite de 2 MB. A coleta foi interrompida.");
  const parsed = z.array(post).safeParse(Array.isArray(response.data) ? response.data.slice(0, 100) : response.data);
  if (!parsed.success) throw new CollectorError("layout_changed", "O formato do feed Valete+ mudou. Revise o esquema com a documentação fornecida.");
  if (parsed.data.length) await page.locator(valeteSelectors.permalinks).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
  const links = await page.locator(valeteSelectors.permalinks).evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
  const items = new Map<string, RawItem>();
  for (const original of parsed.data) {
    const nested = original.OriginalPost ? post.safeParse(original.OriginalPost) : null;
    const item = nested?.success ? nested.data : original;
    const href = links.find(href => { try { const url = new URL(href); return url.protocol === "https:" && url.origin === "https://app.valete.org.br" && !url.username && !url.password && [item.id, original.id].includes(decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "")); } catch { return false; } });
    if (!href) continue;
    const html = item.Article?.body || item.body || item.Article?.subtitle || "";
    const text = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script,style,iframe,object,embed,link,meta,noscript").forEach(element => element.remove());
      doc.body.querySelectorAll("p,div,li,br,h1,h2,h3").forEach(element => element.append(doc.createTextNode("\n")));
      return (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12000);
    }, html.slice(0, 200_000));
    let thumbnail: string | null = null;
    try {
      const image = new URL(item.Article?.imageUri || "", "https://app.valete.org.br");
      if (item.Article?.imageUri && image.protocol === "https:" && !image.username && !image.password && !image.port && image.origin === "https://app.valete.org.br") thumbnail = image.toString();
    } catch { /* Capa não reconhecida: não buscar URL arbitrária. */ }
    const name = item.Article?.bylineName || item.Article?.BylineAuthor?.name || item.Article?.Author?.name || item.Author?.name || "Autor não identificado";
    const timestamp = Date.parse(item.publishedAt || item.createdAt || "");
    items.set(item.id, { platform: "valete", evidence: "valete_feed", externalId: item.id, title: (item.Article?.title || text.slice(0, 180) || "Publicação do Valete+").slice(0, 1000), text, author: name.slice(0, 200), url: href, thumbnail, publishedAt: Number.isFinite(timestamp) ? timestamp : null, durationSeconds: null, metrics: { ...(typeof item.likes === "number" ? { likes: String(item.likes) } : {}), ...(typeof item.comments === "number" ? { replies: String(item.comments) } : {}) } });
  }
  if (parsed.data.length && !items.size) throw new CollectorError("layout_changed", "O feed Valete+ retornou posts, mas nenhum permalink real foi reconhecido no DOM. Links não serão inventados.");
  return [...items.values()];
}
