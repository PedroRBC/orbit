import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readYouTubeHome, readXFeed, assertFeedAccess, allowedBrowserRequest } from "../src/collectors/browser";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
async function fixture(html: string, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html }) : route.abort());
  await page.goto(url);
  return page;
}
const video = `<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=abcdefghijk&pp=tracking">Título da aula</a><ytd-channel-name><a>Autor</a></ytd-channel-name><ytd-thumbnail-overlay-time-status-renderer><span>12:34</span></ytd-thumbnail-overlay-time-status-renderer></ytd-rich-item-renderer>`;
const tweet = `<article data-testid="tweet"><div data-testid="User-Name"><a href="/autor"><span>Autor</span></a></div><a href="/autor/status/1234567890123456789"><time datetime="2026-10-27T10:00:00Z">Agora</time></a><div data-testid="tweetText">Texto de um post de ciência que menciona captcha como notícia.</div><button data-testid="like">42</button><button data-testid="reply">3</button><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/example.jpg"/></div></article>`;

describe("coletores de navegador, DOM sintético e sem rede externa", () => {
  it("lê vídeos da home, duração visível e deduplica sem abrir vídeos", async () => {
    const page = await fixture(`<button id="avatar-btn">Conta</button>${video}${video}`, "https://www.youtube.com/");
    try {
      await assertFeedAccess(page, "youtube");
      const items = await readYouTubeHome(page);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ platform: "youtube", externalId: "abcdefghijk", title: "Título da aula", author: "Autor", durationSeconds: 754, text: "" });
      expect(page.url()).toBe("https://www.youtube.com/");
    } finally { await page.close(); }
  });
  it("lê o bootstrap autenticado da home quando o DOM ainda não renderizou", async () => {
    const data = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { lockupViewModel: { contentId: "abcdefghijk", metadata: { lockupMetadataViewModel: { title: { content: "Vídeo da home autenticada" }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "Canal real" } }] }] } } } } } } } }] } } } }] } } };
    const page = await fixture(`<ytd-rich-item-renderer></ytd-rich-item-renderer><script>window.ytcfg={get:()=>true};window.ytInitialData=${JSON.stringify(data)}</script>`, "https://www.youtube.com/");
    try {
      await assertFeedAccess(page, "youtube");
      expect(await readYouTubeHome(page)).toMatchObject([{ platform: "youtube", externalId: "abcdefghijk", title: "Vídeo da home autenticada", author: "Canal real", evidence: "youtube_home" }]);
    } finally { await page.close(); }
  });
  it("extrai texto/URL/contagens do X sem clicar em curtidas", async () => {
    const page = await fixture(`<a data-testid="AppTabBar_Profile_Link" href="/me">Perfil</a>${tweet}${tweet}`, "https://x.com/home");
    try {
      await assertFeedAccess(page, "x");
      const items = await readXFeed(page);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ platform: "x", externalId: "1234567890123456789", author: "Autor", url: "https://x.com/autor/status/1234567890123456789", metrics: { likes: "42", replies: "3" } });
      expect(items[0].text).toContain("captcha como notícia");
      expect(page.url()).toBe("https://x.com/home");
    } finally { await page.close(); }
  });
  it("para em verificação de conta e exige sessão, sem tentar resolver", async () => {
    const challenge = await fixture('<form id="challenge-form">Verifique sua identidade</form>', "https://x.com/account/access");
    const login = await fixture('<a href="/login">Entrar</a>', "https://www.youtube.com/");
    try {
      await expect(assertFeedAccess(challenge, "x")).rejects.toMatchObject({ code: "verification_required" });
      await expect(assertFeedAccess(login, "youtube")).rejects.toMatchObject({ code: "login_required" });
    } finally { await challenge.close(); await login.close(); }
  });
  it("permite consultas de feed e bloqueia mídia e ações de escrita", () => {
    expect(allowedBrowserRequest("youtube", "POST", "https://www.youtube.com/youtubei/v1/browse?key=fixture", "fetch")).toBe(true);
    expect(allowedBrowserRequest("youtube", "POST", "https://www.youtube.com/youtubei/v1/like/like", "fetch")).toBe(false);
    expect(allowedBrowserRequest("x", "POST", "https://x.com/i/api/graphql/query/FavoriteTweet", "fetch")).toBe(false);
    expect(allowedBrowserRequest("x", "POST", "https://x.com/i/api/graphql/query/HomeTimeline", "fetch")).toBe(true);
    expect(allowedBrowserRequest("x", "GET", "https://pbs.twimg.com/media/test.jpg", "image")).toBe(false);
    expect(allowedBrowserRequest("x", "GET", "https://evil.example/read", "fetch")).toBe(false);
    expect(allowedBrowserRequest("youtube", "GET", "https://script.google.com/macros/s/untrusted/exec?data=private", "fetch")).toBe(false);
    expect(allowedBrowserRequest("youtube", "GET", "https://mail.google.com/mail/u/0/", "document")).toBe(false);
    expect(allowedBrowserRequest("x", "GET", "https://pbs.twimg.com/media/example?format=jpg", "fetch")).toBe(false);
    expect(allowedBrowserRequest("x", "GET", "https://x.com/i/api/graphql/query/FavoriteTweet", "fetch")).toBe(false);
  });
  it("descarta posts do X envolvidos por marcação de publicidade", async () => {
    const page = await fixture(`<div data-testid="placementTracking">${tweet}</div>`, "https://x.com/home");
    try { expect(await readXFeed(page)).toEqual([]); } finally { await page.close(); }
  });
  it("descarta anúncios e URLs externas malformadas", async () => {
    const page = await fixture(`${video.replace("<ytd-channel-name>", "<ytd-ad-slot-renderer>Patrocinado</ytd-ad-slot-renderer><ytd-channel-name>")}${video.replace("/watch?v=abcdefghijk&pp=tracking", "https://evil.example/watch?v=abcdefghijk")}`, "https://www.youtube.com/");
    try { expect(await readYouTubeHome(page)).toEqual([]); } finally { await page.close(); }
  });
});
