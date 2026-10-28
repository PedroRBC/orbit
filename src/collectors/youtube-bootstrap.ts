import type { Page } from "playwright";

type Lockup = { contentId?: string; metadata?: { lockupMetadataViewModel?: { title?: { content?: string }; metadata?: { contentMetadataViewModel?: { metadataRows?: { metadataParts?: { text?: { content?: string } }[] }[] } } } } };
type Bootstrap = { contents?: { twoColumnBrowseResultsRenderer?: { tabs?: { tabRenderer?: { content?: { richGridRenderer?: { contents?: { richItemRenderer?: { content?: { lockupViewModel?: Lockup } } }[] } } } }[] } } };

export function extractYouTubeBootstrap() {
  const data = (window as Window & { ytInitialData?: Bootstrap }).ytInitialData;
  const rows = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.flatMap(tab => tab.tabRenderer?.content?.richGridRenderer?.contents || []).slice(0, 100) || [];
  return rows.flatMap(row => {
    const video = row.richItemRenderer?.content?.lockupViewModel;
    if (!video?.contentId || !/^[A-Za-z0-9_-]{11}$/.test(video.contentId)) return [];
    const metadata = video.metadata?.lockupMetadataViewModel, title = metadata?.title?.content;
    if (!title) return [];
    return [{ href: `https://www.youtube.com/watch?v=${video.contentId}`, title, author: metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || "", duration: "", ad: false }];
  });
}
export function youtubeSessionFlag() {
  return (window as Window & { ytcfg?: { get?: (key: string) => unknown } }).ytcfg?.get?.("LOGGED_IN") === true;
}
export function readYouTubeBootstrap(page: Page) { return page.evaluate(extractYouTubeBootstrap); }
export function hasYouTubeSession(page: Page) { return page.evaluate(youtubeSessionFlag); }
