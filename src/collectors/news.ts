import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { fetchPublicXML, publicFeedURL } from "../lib/public-feed";
import { CollectorError } from "./errors";
import type { RawItem } from "./types";

const parser = new Parser<{ title?: string }, { atomPublished?: string; rssPublished?: string }>({ customFields: { item: [["published", "atomPublished"], ["pubDate", "rssPublished"]] } });
const social = ["youtube.com", "youtu.be", "x.com", "twitter.com", "instagram.com", "valete.org.br"];
export async function parseNewsFeed(xml: string, sourceName: string): Promise<RawItem[]> {
  if (!/<(?:rss|feed)(?:\s|>)/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new CollectorError("layout_changed", "O portal não retornou RSS/Atom seguro. Confira a URL do feed, não uma página de notícias.");
  const feed = await parser.parseString(xml);
  const items = new Map<string, RawItem>();
  for (const entry of feed.items.slice(0, 50)) {
    if (!entry.link || !entry.title?.trim()) continue;
    let url: URL;
    try { url = publicFeedURL(entry.link); } catch { continue; }
    if (social.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    const href = url.href, id = createHash("sha256").update(href).digest("hex");
    // rss-parser usa updated como pubDate no Atom; somente o campo original comprova publicação.
    const date = Date.parse([entry.atomPublished, entry.rssPublished].find(value => typeof value === "string") || "");
    items.set(id, { platform: "news", evidence: "news_rss", externalId: id, title: entry.title.trim().slice(0, 1000), text: (entry.contentSnippet || "").slice(0, 12000), author: (entry.creator || feed.title || sourceName).slice(0, 200), url: href, thumbnail: null, publishedAt: Number.isFinite(date) ? date : null, newsPublishedAt: Number.isFinite(date) ? date : null, durationSeconds: null });
  }
  return [...items.values()];
}
export async function collectNews(url: string, name: string, signal?: AbortSignal) { return parseNewsFeed(await fetchPublicXML(url, signal), name); }
