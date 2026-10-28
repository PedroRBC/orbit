import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readInstagramFeed } from "../src/collectors/instagram";
import { readValeteFeed } from "../src/collectors/valete";
import { assertFeedAccess, allowedBrowserRequest } from "../src/collectors/browser";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
async function fixture(html: string, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html }) : route.abort());
  await page.goto(url);
  return page;
}

describe("Instagram e Valete+, somente fixtures", () => {
  it("coleta legenda sem misturar comentários no Instagram", async () => {
    const page = await fixture('<a href="/direct/inbox/">Inbox</a><article><header><a href="/autor/">Autor</a></header><a href="/p/ABCdef12345/"><time datetime="2026-10-27T10:00:00Z">Hoje</time></a><h1>Legenda da publicação.</h1><div class="comment">Comentário de outra pessoa que não deve ser coletado.</div></article>', "https://www.instagram.com/");
    try {
      await assertFeedAccess(page, "instagram");
      const items = await readInstagramFeed(page);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ platform: "instagram", externalId: "ABCdef12345", text: "Legenda da publicação.", author: "autor", url: "https://www.instagram.com/p/ABCdef12345/" });
      expect(items[0].text).not.toContain("Comentário");
    } finally { await page.close(); }
  });
  it("reconhece a estrutura de legenda/autor observada no perfil autenticado", async () => {
    const page = await fixture('<article><a role="link" class="notranslate" href="/autor_real/">autor_real</a><a href="/p/ABCdef12345/"><time datetime="2026-10-27T10:00:00Z">Hoje</time></a><div><div><a class="notranslate" href="/autor_real/">autor_real</a></div><span dir="auto" class="_aacu">Legenda reconhecida no layout atual.</span></div><div class="comment"><a href="/outra_pessoa/">outra</a><span>Comentário, não legenda.</span></div></article>', "https://www.instagram.com/");
    try { expect((await readInstagramFeed(page))[0]).toMatchObject({ author: "autor_real", text: "Legenda reconhecida no layout atual." }); } finally { await page.close(); }
  });
  it("não toma comentário de outra pessoa por legenda e escolhe a mídia em vez do avatar", async () => {
    const page = await fixture('<article><a class="notranslate" href="/autor/">autor</a><a href="/p/ABCdef12345/"><time datetime="2026-10-27T10:00:00Z">Hoje</time></a><img width="32" src="https://scontent.cdninstagram.com/avatar.jpg"/><img width="468" src="https://scontent.cdninstagram.com/media.jpg"/><div><div><a href="/outra_pessoa/">outra</a></div><span dir="auto" class="_aacu">Comentário de outra pessoa.</span></div></article>', "https://www.instagram.com/");
    try { expect((await readInstagramFeed(page))[0]).toMatchObject({ text: "", thumbnail: "https://scontent.cdninstagram.com/media.jpg" }); } finally { await page.close(); }
  });
  it("lê API documentada do Valete, transforma HTML em texto e não inventa permalink", async () => {
    const page = await fixture('<a href="/a/titulo-real/post-1">Artigo</a>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "post-1", Author: { name: "Redação" }, Article: { id: "article-different", title: "Ciência", body: '<p>Texto &amp; contexto.</p><script>window.injected=true</script>', bylineName: "Autor editorial" }, likes: 10, publishedAt: "2026-10-27T10:00:00Z", liked: true, isBookmarked: true }, { id: "sem-link", Article: { title: "Não inventar URL", body: "Texto" } }]) }));
    try {
      const items = await readValeteFeed(page);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ platform: "valete", externalId: "post-1", title: "Ciência", text: "Texto & contexto.", author: "Autor editorial", url: "https://app.valete.org.br/a/titulo-real/post-1" });
      expect(items[0]).not.toHaveProperty("liked");
      expect(items[0]).not.toHaveProperty("isBookmarked");
      expect(await page.evaluate(() => "injected" in window)).toBe(false);
    } finally { await page.close(); }
  });
  it("usa somente texto visível e permalink do feed quando a API está temporariamente indisponível", async () => {
    const page = await fixture('<article><a href="/u/reporter"><p>Redação</p><p>há pouco</p></a><a href="/p/assunto-real/visible-post"><div class="whitespace-break-spaces">Texto do post já visível, não comentários.</div></a><button>curtir</button></article>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    try { expect(await readValeteFeed(page)).toMatchObject([{ externalId: "visible-post", author: "Redação", text: "Texto do post já visível, não comentários.", url: "https://app.valete.org.br/p/assunto-real/visible-post", evidence: "valete_dom" }]); } finally { await page.close(); }
  });
  it("rejeita HTML de login mesmo com status 200", async () => {
    const page = await fixture('<a href="/a/titulo/post-1">Artigo</a>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "text/html", body: "<html>Faça login</html>" }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "login_required" }); } finally { await page.close(); }
  });
  it("não usa o DOM como fallback quando a API nega login", async () => {
    const page = await fixture('<article><a href="/p/post/visible"><div class="whitespace-break-spaces">Texto em cache</div></a></article>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ status: 403, contentType: "application/json", body: "{}" }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "login_required" }); } finally { await page.close(); }
  });
  it("interrompe 429 do Valete e informa Retry-After", async () => {
    const page = await fixture("<main>Feed</main>", "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ status: 429, headers: { "Retry-After": "3600" }, contentType: "application/json", body: "{}" }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 3600000 }); } finally { await page.close(); }
  });
  it("não segue redirecionamento de API para login", async () => {
    const page = await fixture("<main>Feed</main>", "https://app.valete.org.br/");
    let followed = false;
    await page.route("**/login", route => { followed = true; return route.abort(); });
    await page.route("**/api/post?filter=all", route => route.fulfill({ status: 302, headers: { Location: "/login" }, body: "" }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "login_required" }); expect(followed).toBe(false); } finally { await page.close(); }
  });
  it("não inventa permalink quando o feed não oferece um link reconhecido", async () => {
    const page = await fixture('<a href="https://evil.example/a/titulo/post-1">Não confiável</a>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "post-1", Article: { title: "Não fabricar slug", body: "Texto" } }]) }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "layout_changed" }); } finally { await page.close(); }
  }, 10000);
  it("não expõe leitores a capas de buckets de terceiros", async () => {
    const page = await fixture('<a href="/a/titulo/post-1">Artigo</a>', "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "post-1", Article: { title: "Artigo", imageUri: "https://storage.googleapis.com/untrusted-bucket/pixel.png", body: "Texto" } }]) }));
    try { expect((await readValeteFeed(page))[0].thumbnail).toBeNull(); } finally { await page.close(); }
  });
  it("tolera metadados nulos e limita a lista sem rejeitar 101 posts", async () => {
    const page = await fixture('<a href="/a/titulo/post-1">Artigo</a>', "https://app.valete.org.br/");
    const posts = Array.from({ length: 101 }, (_, index) => ({ id: `post-${index + 1}`, Article: { id: null, title: "Artigo", body: "Texto" }, likes: null, comments: null }));
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(posts) }));
    try { expect(await readValeteFeed(page)).toHaveLength(1); } finally { await page.close(); }
  });
  it("não confunde JSON truncado com sessão expirada", async () => {
    const page = await fixture("<main>Feed</main>", "https://app.valete.org.br/");
    await page.route("**/api/post?filter=all", route => route.fulfill({ contentType: "application/json", body: '{"incompleto":' }));
    try { await expect(readValeteFeed(page)).rejects.toMatchObject({ code: "layout_changed" }); } finally { await page.close(); }
  });
  it("bloqueia escrita e hosts fora das plataformas", () => {
    expect(allowedBrowserRequest("instagram", "POST", "https://www.instagram.com/api/v1/web/likes/123/like/", "fetch")).toBe(false);
    expect(allowedBrowserRequest("instagram", "GET", "https://www.instagram.com/api/v1/feed/timeline/", "fetch")).toBe(true);
    expect(allowedBrowserRequest("instagram", "POST", "https://www.instagram.com/api/v1/feed/timeline/", "fetch")).toBe(true);
    expect(allowedBrowserRequest("valete", "GET", "https://app.valete.org.br/api/post?filter=all", "fetch")).toBe(true);
    expect(allowedBrowserRequest("valete", "POST", "https://app.valete.org.br/api/post", "fetch")).toBe(false);
    expect(allowedBrowserRequest("valete", "GET", "https://id.valete.org.br/auth/login", "document")).toBe(false);
  });
});
