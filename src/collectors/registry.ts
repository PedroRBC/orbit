import type { sources } from "../db/schema";
import type { Collector } from "./types";
import type { OrbitDB } from "../db/index";
import { collectNews } from "./news";
import { collectChannel } from "./youtube";
import { collectThroughExtension } from "./extension";
import { z } from "zod";
import { readEnvironment } from "../lib/ai-environment";

export function collectorForSource(source: typeof sources.$inferSelect, db: OrbitDB, runId: number, signal?: AbortSignal, assertActive: () => void = () => {}): Collector {
  return { collect: async () => {
    const items = source.kind === "youtube_rss" ? await collectChannel(source.channelId, signal) : source.kind === "news_rss" ? await collectNews(source.channelId, source.name, signal) : await collectThroughExtension(db, source.id, runId, signal, assertActive);
    return items.slice(0, z.coerce.number().int().min(1).max(50).parse(readEnvironment().env.COLLECTOR_MAX_ITEMS || "20"));
  } };
}
