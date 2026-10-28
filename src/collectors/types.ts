export type RawItem = {
  platform: "youtube" | "x" | "instagram" | "valete" | "news";
  externalId: string;
  title: string;
  text: string;
  author: string;
  url: string;
  thumbnail: string | null;
  publishedAt: number | null;
  newsPublishedAt?: number | null;
  durationSeconds: number | null;
  metrics?: Record<string, string>;
  evidence?: "rss" | "youtube_home" | "x_for_you" | "instagram_feed" | "valete_feed" | "valete_dom" | "news_rss";
};
export interface Collector { collect(): Promise<RawItem[]> }
export type BrowserPlatform = "youtube" | "x" | "instagram" | "valete";
export const browserURLs: Record<BrowserPlatform, string> = { youtube: "https://www.youtube.com/", x: "https://x.com/home", instagram: "https://www.instagram.com/", valete: "https://app.valete.org.br/" };
export const browserSourceKinds = { youtube: "youtube_home", x: "x_for_you", instagram: "instagram_feed", valete: "valete_feed" } as const;
export const platformLabels = { youtube: "YouTube", x: "X", instagram: "Instagram", valete: "Valete+", news: "RSS externo" } as const;
export const browserSourceLabels = { youtube: "Home do YouTube", x: "X · Para você", instagram: "Instagram · Feed", valete: "Valete+ · Feed" } as const;
