import type { Page } from "playwright";
import type { RawItem } from "./types";
import { valeteSelectors } from "./selectors/valete";

export async function readValeteDOM(page: Page): Promise<RawItem[]> {
  const cards = await page.locator(valeteSelectors.cards).evaluateAll((elements, selectors) => elements.slice(0, 50).map(card => {
    const body = card.querySelector(selectors.postText);
    const link = body?.closest<HTMLAnchorElement>("a") || card.querySelector<HTMLAnchorElement>(selectors.articleLink);
    return { href: link?.href || "", text: body?.textContent || link?.textContent || "", title: link?.querySelector("h1,h2,h3")?.textContent || "", author: card.querySelector(selectors.author)?.textContent || "", date: card.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime || "" };
  }), valeteSelectors);
  const items = new Map<string, RawItem>();
  for (const card of cards) {
    if (!card.text.trim()) continue;
    let url: URL, id: string;
    try {
      url = new URL(card.href);
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.origin !== "https://app.valete.org.br" || url.username || url.password || !["p", "a", "post"].includes(parts[0]) || parts.length < 3) continue;
      id = decodeURIComponent(parts.at(-1)!); if (!id || id.length > 200) continue;
    } catch { continue; }
    const text = card.text.replace(/\s+/g, " ").trim().slice(0, 12000), date = Date.parse(card.date);
    items.set(id, { platform: "valete", evidence: "valete_dom", externalId: id, title: (card.title.trim() || text.slice(0, 180)).slice(0, 1000), text, author: card.author.trim().slice(0, 200) || "Autor não identificado", url: url.href, thumbnail: null, publishedAt: Number.isFinite(date) ? date : null, durationSeconds: null });
  }
  return [...items.values()];
}
