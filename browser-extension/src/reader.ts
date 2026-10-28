import type { Page } from "playwright";
import { assertFeedAccess, readYouTubeHome, readXFeed } from "../../src/collectors/readers";
import { readInstagramFeed } from "../../src/collectors/instagram";
import { readValeteFeed } from "../../src/collectors/valete";
import { extractYouTubeBootstrap, youtubeSessionFlag } from "../../src/collectors/youtube-bootstrap";
import { browserURLs, type BrowserPlatform, type RawItem } from "../../src/collectors/types";
import { CollectorError } from "../../src/collectors/errors";

type Bootstrap = { loggedIn: boolean; cards: ReturnType<typeof extractYouTubeBootstrap> };
let stopped = false;
export function stop() { stopped = true; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function locator(selector: string) {
  return {
    first() { return this; },
    async isVisible() { const element = document.querySelector<HTMLElement>(selector); return !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== "hidden"; },
    async evaluateAll(fn: (elements: Element[], arg: unknown) => unknown, arg: unknown) { return fn([...document.querySelectorAll(selector)], arg); },
    async waitFor(options: { timeout: number }) {
      const until = Date.now() + options.timeout;
      while (!document.querySelector(selector)) { if (Date.now() >= until) throw new Error("Seletor indisponível"); await delay(100); }
    },
  };
}
export async function collect(platform: BrowserPlatform, maxItems: number, bootstrap?: Bootstrap) {
  try {
    if (!Object.hasOwn(browserURLs, platform) || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50 || location.origin !== new URL(browserURLs[platform]).origin) return { error: "login_required" };
    const expected = new URL(browserURLs[platform]);
    const inScope = () => location.origin === expected.origin && location.pathname === expected.pathname && !stopped;
    // Adaptador somente de leitura; a sessão/bootstrap YouTube chega de uma injeção MAIN sem credenciais.
    const page = { url: () => location.href, locator, evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn === extractYouTubeBootstrap && bootstrap ? bootstrap.cards : fn === youtubeSessionFlag && bootstrap ? bootstrap.loggedIn : fn(arg) } as unknown as Page;
    const until = Date.now() + 35_000;
    await delay(1500);
    await assertFeedAccess(page, platform);
    if (!inScope()) return { error: stopped ? "user_interrupted" : "layout_changed" };
    if (platform === "x") {
      const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(element => /^(For you|Para você)$/i.test((element.getAttribute("aria-label") || element.textContent || "").trim()));
      if (!tab) return { error: "layout_changed" };
      if (tab.getAttribute("aria-selected") !== "true") { tab.click(); await delay(1200); }
      if (tab.getAttribute("aria-selected") !== "true") return { error: "layout_changed" };
    }
    if (platform === "valete") { const items = await readValeteFeed(page); await assertFeedAccess(page, platform); return inScope() ? { items: items.slice(0, maxItems) } : { error: "browser_unavailable" }; }
    const items = new Map<string, RawItem>();
    for (let scroll = 0; scroll < 4; scroll++) {
      if (Date.now() > until || !inScope()) return { error: "browser_unavailable" };
      await assertFeedAccess(page, platform);
      const found = await (platform === "youtube" ? readYouTubeHome(page) : platform === "x" ? readXFeed(page) : readInstagramFeed(page));
      for (const item of found) items.set(item.externalId, item);
      if (items.size >= maxItems) break;
      window.scrollBy({ top: 650, behavior: "smooth" });
      await delay(900 + Math.floor(Math.random() * 901));
    }
    await assertFeedAccess(page, platform);
    if (!inScope()) return { error: "browser_unavailable" };
    return items.size ? { items: [...items.values()].slice(0, maxItems) } : { error: "layout_changed" };
  } catch (error) {
    if (error instanceof CollectorError) return { error: error.code, ...(error.retryAfterMs ? { retryAfterMs: Math.min(604800000, Math.ceil(error.retryAfterMs)) } : {}) };
    return { error: "browser_unavailable" };
  }
}
