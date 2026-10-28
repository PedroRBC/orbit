import Parser from "rss-parser";

import type { RawItem, Collector } from "./types";
export type { RawItem, Collector } from "./types";
const channelPattern = /^UC[A-Za-z0-9_-]{22}$/;

export function normalizeChannel(input: string): string {
  const value = input.trim();
  if (channelPattern.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["youtube.com", "www.youtube.com"].includes(url.hostname) && !url.username && !url.password && !url.port) {
      const match = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/);
      if (match) return match[1];
    }
  } catch { /* A mensagem abaixo também cobre IDs inválidos. */ }
  throw new Error("Informe o ID UC… ou uma URL youtube.com/channel/UC…. Links @handle não contêm o ID exigido pelo RSS.");
}

const parser = new Parser<Record<string, never>, { videoId?: string; channelId?: string; author?: string; media?: { "media:description"?: string[] } }>({
  customFields: { item: [["yt:videoId", "videoId"], ["yt:channelId", "channelId"], ["media:group", "media"]] },
});

export async function parseYouTubeFeed(xml: string, channelId: string): Promise<RawItem[]> {
  if (!xml.includes("<feed") || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("O YouTube retornou um feed inválido.");
  const feed = await parser.parseString(xml);
  const unique = new Map<string, RawItem>();
  for (const item of feed.items.slice(0, 20)) {
    const id = item.videoId;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id) || (item.channelId && item.channelId !== channelId)) continue;
    const timestamp = item.pubDate ? Date.parse(item.pubDate) : NaN;
    unique.set(id, { platform: "youtube", externalId: id, title: (item.title || "Vídeo sem título").slice(0, 1000), text: (item.media?.["media:description"]?.[0] || item.contentSnippet || "").slice(0, 12000), author: (item.author || item.creator || feed.title || channelId).slice(0, 200), url: `https://www.youtube.com/watch?v=${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, publishedAt: Number.isFinite(timestamp) ? timestamp : null, durationSeconds: null });
  }
  return [...unique.values()];
}

export async function collectChannel(channelId: string, signal?: AbortSignal): Promise<RawItem[]> {
  const id = normalizeChannel(channelId);
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]), headers: { Accept: "application/atom+xml, application/xml, text/xml" } });
  if (!response.ok) throw new Error(`YouTube respondeu HTTP ${response.status}. Verifique o canal e tente novamente mais tarde.`);
  if (Number(response.headers.get("content-length")) > 1_000_000) throw new Error("Feed maior que o limite permitido.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Feed vazio.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) throw new Error("Feed maior que o limite permitido.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return parseYouTubeFeed(Buffer.concat(chunks).toString("utf8"), id);
}

export function youtubeCollector(channelId: string): Collector {
  return { collect: () => collectChannel(channelId) };
}
