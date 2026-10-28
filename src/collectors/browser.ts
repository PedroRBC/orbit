import type { BrowserPlatform } from "./types";
export { browserURLs } from "./types";
export { readYouTubeHome, readXFeed, assertFeedAccess } from "./readers";

export const platformRequestRoots: Record<BrowserPlatform, string[]> = {
  youtube: ["youtube.com", "ytimg.com", "gstatic.com"],
  x: ["x.com", "twitter.com", "twimg.com"],
  instagram: ["instagram.com", "cdninstagram.com", "fbcdn.net"],
  valete: ["app.valete.org.br"],
};
export const readPostPatterns: Record<BrowserPlatform, string | null> = {
  youtube: "^https://(?:www\\.)?youtube\\.com/youtubei/v1/browse(?:\\?|$)",
  x: "^https://(?:www\\.|api\\.)?x\\.com/i/api/graphql/[^/]+/HomeTimeline(?:\\?|$)",
  instagram: "^https://(?:www\\.)?instagram\\.com/api/v1/feed/timeline/(?:\\?|$)",
  valete: null,
};
export const mediaPathPattern = "(/media/|/ext_tw_video|/amplify_video|\\.(jpe?g|png|webp|gif|avif|mp4|webm|m3u8|m4s|mp3)(\\?|$))";
export const mutationPathPattern = "/(like|unlike|subscribe|unsubscribe|comment|follow|unfollow)(/|\\?|$)|/(FavoriteTweet|UnfavoriteTweet|CreateTweet|DeleteTweet|CreateRetweet|DeleteRetweet)(\\?|$)";

export function allowedBrowserRequest(platform: BrowserPlatform, method: string, href: string, resourceType: string): boolean {
  if (["image", "media", "font", "websocket", "sub_frame"].includes(resourceType)) return false;
  let url: URL;
  try { url = new URL(href); } catch { return false; }
  if (url.protocol !== "https:" || new RegExp(mediaPathPattern, "i").test(href) || new RegExp(mutationPathPattern, "i").test(href)) return false;
  if (!platformRequestRoots[platform].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return false;
  if (platform === "valete" && url.hostname !== "app.valete.org.br") return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return method === "POST" && !!readPostPatterns[platform] && new RegExp(readPostPatterns[platform]!).test(href);
}
