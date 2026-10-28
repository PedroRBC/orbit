import type { Page } from "playwright";
import type { RawItem } from "./types";
import { instagramSelectors } from "./selectors/instagram";

export async function readInstagramFeed(page: Page): Promise<RawItem[]> {
  const cards = await page.locator(instagramSelectors.cards).evaluateAll((elements, selectors) => elements.slice(0, 100).map(card => {
    const time = card.querySelector<HTMLTimeElement>(selectors.link);
    const link = time?.closest<HTMLAnchorElement>("a") || card.querySelector<HTMLAnchorElement>(selectors.fallbackLink);
    const author = card.querySelector<HTMLAnchorElement>(selectors.author);
    const caption = card.querySelector(selectors.caption) || [...card.querySelectorAll(selectors.captionByAuthor)].find(span => [...(span.previousElementSibling?.querySelectorAll<HTMLAnchorElement>("a[href]") || [])].some(anchor => anchor.pathname === author?.pathname));
    const image = [...card.querySelectorAll<HTMLImageElement>(selectors.image)].find(image => image.getBoundingClientRect().width >= 150 || Number(image.getAttribute("width")) >= 150);
    return { href: link?.href || "", author: author?.pathname || "", text: caption?.textContent || "", date: time?.dateTime || "", image: image?.src || "", likes: card.querySelector(selectors.likes)?.textContent || "", ad: !!card.querySelector(selectors.ad) || !!card.closest(selectors.ad) };
  }), instagramSelectors);
  const items = new Map<string, RawItem>();
  for (const card of cards) {
    if (card.ad) continue;
    let url: URL;
    try { url = new URL(card.href); } catch { continue; }
    const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{5,30})\/?$/);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || !match) continue;
    const author = card.author.match(/^\/([A-Za-z0-9_.]{1,30})\/?$/)?.[1] || "Autor não identificado";
    const text = card.text.trim().slice(0, 12000);
    let thumbnail: string | null = null;
    try { const image = new URL(card.image); if (image.protocol === "https:" && ["cdninstagram.com", "fbcdn.net"].some(host => image.hostname === host || image.hostname.endsWith(`.${host}`))) thumbnail = image.toString(); } catch { /* Thumbnail não reconhecida. */ }
    const timestamp = Date.parse(card.date);
    const likes = card.likes.trim();
    items.set(match[2], { platform: "instagram", evidence: "instagram_feed", externalId: match[2], title: text.slice(0, 180) || `Publicação de ${author}`, text, author, url: `https://www.instagram.com/${match[1]}/${match[2]}/`, thumbnail, publishedAt: Number.isFinite(timestamp) ? timestamp : null, durationSeconds: null, metrics: /^[\d.,\s]+(?:\s*(?:mil|mi|k|m))?$/i.test(likes) ? { likes } : {} });
  }
  return [...items.values()];
}
