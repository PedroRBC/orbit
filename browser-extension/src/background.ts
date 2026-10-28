import { browserURLs, type BrowserPlatform } from "../../src/collectors/types";
import { extractYouTubeBootstrap, youtubeSessionFlag } from "../../src/collectors/youtube-bootstrap";
import { captureRules, captureRuleIds } from "./policy";

type Config = { server: string; token: string };
type Job = { id: string; platform: BrowserPlatform; maxItems: number; expiresAt: number };
let busy = false;
function serverURL(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use a URL local do Orbit, como http://127.0.0.1:3001.");
  return url.origin;
}
async function send(config: Config, action: string, input: unknown) {
  const response = await fetch(`${serverURL(config.server)}/api/extension/${action}`, { method: "POST", credentials: "omit", redirect: "error", headers: { "Content-Type": "application/json", "X-Orbit-Extension-Id": chrome.runtime.id, "X-Orbit-Extension-Version": chrome.runtime.getManifest().version, ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha na conexão local.");
  return data;
}
const touchedTabs = new Set<number>();
let interruptCapture: { tabId: number; stop: () => void } | undefined;
chrome.tabs.onActivated.addListener(info => {
  if (interruptCapture?.tabId === info.tabId) {
    touchedTabs.add(info.tabId); interruptCapture.stop();
    void chrome.scripting.executeScript({ target: { tabId: info.tabId }, world: "ISOLATED", func: () => { (globalThis as typeof globalThis & { OrbitFeedReader?: { stop: () => void } }).OrbitFeedReader?.stop(); } }).catch(() => {});
  }
  void chrome.storage.session.get<{ ownedTab?: number }>("ownedTab").then(state => { if (state.ownedTab === info.tabId) { touchedTabs.add(info.tabId); return chrome.storage.session.set({ touched: true }); } });
});
async function closeOwnedTab() {
  const { ownedTab, touched } = await chrome.storage.session.get<{ ownedTab?: number; touched?: boolean }>(["ownedTab", "touched"]);
  if (typeof ownedTab === "number") {
    try { const tab = await chrome.tabs.get(ownedTab); if (!tab.active && !touched && !touchedTabs.has(ownedTab)) await chrome.tabs.remove(ownedTab); } catch { /* Aba já fechada. */ }
    touchedTabs.delete(ownedTab);
  }
  await chrome.storage.session.remove(["ownedTab", "touched"]);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: captureRuleIds });
}
async function capture(job: Job) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stage = "navigation_failed";
  try {
    if (!Object.hasOwn(browserURLs, job.platform) || !Number.isInteger(job.maxItems) || job.maxItems < 1 || job.maxItems > 50 || job.expiresAt <= Date.now()) return { error: "browser_unavailable" };
    if (!await chrome.permissions.contains({ origins: [`${new URL(browserURLs[job.platform]).origin}/*`] })) return { error: "permission_required" };
    if (!(await chrome.windows.getAll({ windowTypes: ["normal"] })).length) return { error: "browser_unavailable" };
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    if (!tab.id) return { error: "browser_unavailable" };
    const tabId = tab.id;
    let cancelled = tab.active;
    const interrupted = new Promise(resolve => { interruptCapture = { tabId, stop: () => { cancelled = true; resolve({ error: "user_interrupted" }); } }; });
    touchedTabs.delete(tabId);
    await chrome.storage.session.set({ ownedTab: tabId, touched: false });
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: captureRules(tabId, job.platform), removeRuleIds: captureRuleIds });
    if (cancelled) return { error: "browser_unavailable" };
    await chrome.tabs.update(tabId, { url: browserURLs[job.platform] });
    const result = (async () => {
      const until = Date.now() + 20_000;
      while (true) {
        const current = await chrome.tabs.get(tabId);
        if (cancelled) return { error: "user_interrupted" };
        if (current.status === "complete" && current.url && current.url !== "about:blank") {
          const url = new URL(current.url);
          if (url.origin !== new URL(browserURLs[job.platform]).origin) return { error: "login_required" };
          if (/\/(login|auth)(\/|$)/.test(url.pathname)) return { error: "login_required" };
          break;
        }
        if (Date.now() > until) return { error: "navigation_failed" };
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (cancelled) return { error: "user_interrupted" };
      stage = "script_injection_failed";
      let bootstrap;
      if (job.platform === "youtube") {
        const cards = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: extractYouTubeBootstrap });
        const session = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: youtubeSessionFlag });
        bootstrap = { cards: cards[0]?.result || [], loggedIn: session[0]?.result === true };
      }
      if (cancelled) return { error: "browser_unavailable" };
      await chrome.scripting.executeScript({ target: { tabId }, files: ["reader.js"], world: "ISOLATED" });
      if (cancelled) return { error: "browser_unavailable" };
      const response = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: async (platform: string, limit: number, bootstrap: unknown) => {
        const api = (globalThis as typeof globalThis & { OrbitFeedReader?: { collect: (platform: string, limit: number, bootstrap: unknown) => Promise<unknown> } }).OrbitFeedReader;
        return api ? api.collect(platform, limit, bootstrap) : { error: "browser_unavailable" };
      }, args: [job.platform, job.maxItems, bootstrap || null] });
      return response[0]?.result || { error: "browser_unavailable" };
    })();
    return await Promise.race([result, interrupted, new Promise(resolve => { timer = setTimeout(() => resolve({ error: "capture_timeout" }), 45_000); })]);
  } catch (error) {
    if (error instanceof Error && /id\.valete\.org\.br|accounts\.google\.com|\/accounts\/login|\/i\/(flow|jf)\//.test(error.message)) return { error: "login_required" };
    return { error: stage };
  }
  finally { if (timer) clearTimeout(timer); interruptCapture = undefined; await closeOwnedTab().catch(() => {}); }
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const { connection } = await chrome.storage.local.get<{ connection?: Config }>("connection");
    if (!connection?.token) return;
    await closeOwnedTab();
    const data = await send(connection as Config, "poll", {});
    await chrome.storage.local.set({ status: "Conectada ao Orbit", lastSeen: Date.now() });
    if (data.job) await send(connection as Config, "result", { id: data.job.id, result: await capture(data.job as Job) });
  } catch (error) { await chrome.storage.local.set({ status: error instanceof Error ? error.message : "Orbit indisponível. Abra o app local." }); }
  finally { busy = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  if (message?.type === "pair") {
    (async () => {
      const server = serverURL(String(message.server || ""));
      const result = await send({ server, token: "" }, "pair", { code: String(message.code || "").trim() });
      await chrome.storage.local.set({ connection: { server, token: result.token }, status: "Conectada ao Orbit", lastSeen: Date.now() });
      return { ok: true };
    })().then(result => { respond(result); void poll(); }, error => respond({ error: error instanceof Error ? error.message : "Não foi possível parear." }));
    return true;
  }
  if (message?.type === "disconnect") {
    (async () => { const { connection } = await chrome.storage.local.get<{ connection?: Config }>("connection"); if (connection) await send(connection as Config, "disconnect", {}).catch(() => {}); await chrome.storage.local.remove(["connection", "lastSeen"]); await chrome.storage.local.set({ status: "Desconectada" }); return { ok: true }; })().then(respond);
    return true;
  }
  if (message?.type === "check") { void poll().then(() => respond({ ok: true })); return true; }
  return false;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "orbit-poll") void poll(); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create("orbit-poll", { periodInMinutes: 0.5 }); void poll(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create("orbit-poll", { periodInMinutes: 0.5 }); void poll(); });
void chrome.alarms.create("orbit-poll", { periodInMinutes: 0.5 });
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
