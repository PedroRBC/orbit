import type { Page } from "playwright";
import { browserURLs, type BrowserPlatform, type RawItem } from "./types";
import { CollectorError } from "./errors";
import { hasYouTubeSession, readYouTubeBootstrap } from "./youtube-bootstrap";
import { youtubeSelectors } from "./selectors/youtube";
import { xSelectors } from "./selectors/x";
import { instagramSelectors } from "./selectors/instagram";
import { valeteSelectors } from "./selectors/valete";

export const platformSelectors = { youtube: youtubeSelectors, x: xSelectors, instagram: instagramSelectors, valete: valeteSelectors };
function youtubeId(href: string): string | null {
  try {
    const url = new URL(href), id = url.searchParams.get("v");
    return url.protocol === "https:" && ["youtube.com", "www.youtube.com"].includes(url.hostname) && url.pathname === "/watch" && id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
function duration(value: string): number | null {
  const clean = value.trim();
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(clean)) return null;
  const parts = clean.split(":").map(Number);
  if (parts.slice(1).some(part => part > 59)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
export async function readYouTubeHome(page: Page): Promise<RawItem[]> {
  const cards = await page.locator(youtubeSelectors.cards).evaluateAll((elements, selectors) => elements.slice(0, 100).map(card => {
    const link = card.querySelector<HTMLAnchorElement>(selectors.title) || card.querySelector<HTMLAnchorElement>(selectors.link);
    return { href: link?.href || "", title: link?.getAttribute("title") || link?.textContent || "", author: card.querySelector(selectors.author)?.textContent || "", duration: card.querySelector(selectors.duration)?.textContent || "", ad: !!card.querySelector(selectors.ad) || !!card.closest(selectors.ad) };
  }), youtubeSelectors);
  if (!cards.some(card => youtubeId(card.href) && card.title.trim())) cards.push(...await readYouTubeBootstrap(page));
  const items = new Map<string, RawItem>();
  for (const card of cards) {
    const id = youtubeId(card.href);
    if (!id || card.ad || !card.title.trim()) continue;
    items.set(id, { platform: "youtube", externalId: id, title: card.title.trim().slice(0, 1000), text: "", evidence: "youtube_home", author: card.author.trim().slice(0, 200) || "Autor não identificado", url: `https://www.youtube.com/watch?v=${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, publishedAt: null, durationSeconds: duration(card.duration) });
  }
  return [...items.values()];
}
export async function readXFeed(page: Page): Promise<RawItem[]> {
  const cards = await page.locator(xSelectors.cards).evaluateAll((elements, selectors) => elements.slice(0, 100).map(card => {
    const time = card.querySelector<HTMLTimeElement>(selectors.time);
    return { href: time?.closest<HTMLAnchorElement>("a")?.href || "", date: time?.dateTime || "", text: card.querySelector(selectors.text)?.textContent || "", author: card.querySelector(selectors.author)?.textContent || "", image: card.querySelector<HTMLImageElement>(selectors.photo)?.src || "", ad: !!card.querySelector(selectors.ad) || !!card.closest(selectors.ad), likes: card.querySelector(selectors.likes)?.textContent?.trim() || "", replies: card.querySelector(selectors.replies)?.textContent?.trim() || "", reposts: card.querySelector(selectors.reposts)?.textContent?.trim() || "" };
  }), xSelectors);
  const items = new Map<string, RawItem>();
  for (const card of cards) {
    if (card.ad) continue;
    let url: URL;
    try { url = new URL(card.href); } catch { continue; }
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,30})\/status\/(\d{5,25})\/?$/);
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) || !match) continue;
    const timestamp = Date.parse(card.date);
    let thumbnail: string | null = null;
    try { const image = new URL(card.image); if (image.protocol === "https:" && image.hostname === "pbs.twimg.com" && image.pathname.startsWith("/media/")) thumbnail = image.toString(); } catch { /* Sem imagem válida. */ }
    const text = card.text.trim().slice(0, 12000), author = card.author.trim().slice(0, 200) || match[1];
    items.set(match[2], { platform: "x", evidence: "x_for_you", externalId: match[2], title: text.slice(0, 180) || `Publicação de ${author}`, text, author, url: `https://x.com/${match[1]}/status/${match[2]}`, thumbnail, publishedAt: Number.isFinite(timestamp) ? timestamp : null, durationSeconds: null, metrics: { likes: card.likes.slice(0, 40), replies: card.replies.slice(0, 40), reposts: card.reposts.slice(0, 40) } });
  }
  return [...items.values()];
}
export async function assertFeedAccess(page: Page, platform: BrowserPlatform) {
  const selectors = platformSelectors[platform], url = new URL(page.url());
  if (/captcha|challenge|checkpoint|\/sorry\/|\/account\/(access|locked|suspended)/i.test(url.pathname) || await page.locator(selectors.challenge).first().isVisible()) throw new CollectorError("verification_required", "A plataforma pediu verificação. A coleta parou; conclua o fluxo normal manualmente.");
  const correctOrigin = url.hostname === new URL(browserURLs[platform]).hostname || (platform === "x" && url.hostname === "twitter.com");
  if (!correctOrigin || /\/login|\/i\/(flow|jf\/onboarding)/i.test(url.pathname) || (platform !== "valete" && !await page.locator(selectors.account).first().isVisible() && !(platform === "youtube" && await hasYouTubeSession(page)))) throw new CollectorError("login_required", `Entre normalmente em ${platform} pelo seu navegador e solicite outra atualização no Orbit.`);
}
