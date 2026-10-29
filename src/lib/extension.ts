import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../db/index";
import { collectorRuns, companionJobs, settings, sources } from "../db/schema";
import { browserSourceKinds, type BrowserPlatform, type RawItem } from "../collectors/types";
import { CollectorError } from "../collectors/errors";
import { getSetting, setSetting } from "./store";
import { readEnvironment } from "./ai-environment";

const pairingKey = "extension_pairing";
const connectionKey = "extension_connection";
const extensionIdPattern = /^[a-p]{32}$/;
type Connection = { extensionId: string; tokenHash: string; serverOrigin: string; createdAt: number; lastSeen: number; clientVersion?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(b));
export class ExtensionError extends Error { constructor(message: string, public status = 400) { super(message); } }
function connection(db: OrbitDB): Connection | null { const value = getSetting(db, connectionKey); return value ? JSON.parse(value) : null; }
export function extensionOriginAllowed(origin: string | null, id: string) {
  return extensionIdPattern.test(id) && (origin === null || origin === `chrome-extension://${id}`);
}
export function connectionStatus(db: OrbitDB) {
  const value = connection(db);
  return { paired: !!value, online: !!value && value.lastSeen > Date.now() - 95_000, extensionId: value?.extensionId ?? null, lastSeen: value?.lastSeen ?? null, version: value?.clientVersion ?? null };
}
export function createPairingCode(db: OrbitDB) {
  const code = randomBytes(24).toString("base64url");
  setSetting(db, pairingKey, JSON.stringify({ hash: hash(code), expiresAt: Date.now() + 10 * 60_000, attempts: 0 }));
  return code;
}
export function pairExtension(db: OrbitDB, code: string, extensionId: string, serverOrigin: string) {
  if (!extensionIdPattern.test(extensionId)) throw new ExtensionError("Extensão inválida.");
  const url = new URL(serverOrigin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback)) || url.username || url.password) throw new ExtensionError("O pareamento exige HTTPS (ou HTTP só em localhost).");
  const result = db.transaction(() => {
    const stored = getSetting(db, pairingKey);
    const pairing = stored ? JSON.parse(stored) as { hash: string; expiresAt: number; attempts: number } : null;
    if (!pairing || pairing.expiresAt <= Date.now() || pairing.attempts >= 10) return null;
    pairing.attempts++;
    setSetting(db, pairingKey, JSON.stringify(pairing));
    if (!sameHash(code, pairing.hash)) return null;
    const token = randomBytes(32).toString("base64url");
    setSetting(db, connectionKey, JSON.stringify({ extensionId, tokenHash: hash(token), serverOrigin: url.origin, createdAt: Date.now(), lastSeen: Date.now() } satisfies Connection));
    db.delete(settings).where(eq(settings.key, pairingKey)).run();
    db.update(companionJobs).set({ status: "error", result: null, errorCode: "companion_required" }).where(inArray(companionJobs.status, ["queued", "claimed"])).run();
    return { token, serverOrigin: url.origin };
  }, { behavior: "immediate" });
  if (!result) throw new ExtensionError("Código inválido, expirado ou já utilizado.", 401);
  return result;
}
export function verifyExtension(db: OrbitDB, token: string, extensionId: string, version?: string | null): Connection {
  const value = connection(db);
  if (!value || value.extensionId !== extensionId || token.length > 200 || !sameHash(token, value.tokenHash)) throw new ExtensionError("Conexão não autorizada. Faça o pareamento novamente.", 401);
  value.lastSeen = Date.now();
  if (version && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/.test(version)) value.clientVersion = version;
  setSetting(db, connectionKey, JSON.stringify(value));
  return value;
}
export function revokeExtension(db: OrbitDB) {
  db.transaction(() => {
    db.delete(settings).where(inArray(settings.key, [pairingKey, connectionKey])).run();
    db.update(companionJobs).set({ status: "error", result: null, errorCode: "companion_required" }).where(inArray(companionJobs.status, ["queued", "claimed"])).run();
  }, { behavior: "immediate" });
}
function jobActive(db: OrbitDB, job: typeof companionJobs.$inferSelect) {
  const lease = JSON.parse(getSetting(db, "worker_lease") || "null") as { owner: string; expires: number } | null;
  const source = db.select().from(sources).where(eq(sources.id, job.sourceId)).get();
  const run = db.select().from(collectorRuns).where(eq(collectorRuns.id, job.runId)).get();
  const parent = run?.parentId ? db.select().from(collectorRuns).where(eq(collectorRuns.id, run.parentId)).get() : null;
  if (!lease || lease.owner !== job.owner || lease.expires <= Date.now() || job.expiresAt <= Date.now() || !source?.enabled || run?.status !== "running" || parent?.status !== "running") throw new ExtensionError("Pedido vencido ou interrompido.", 409);
  return source;
}
export function createCaptureJob(db: OrbitDB, sourceId: number, runId: number) {
  return db.transaction(() => {
    db.delete(companionJobs).where(lt(companionJobs.expiresAt, Date.now())).run();
    const lease = JSON.parse(getSetting(db, "worker_lease") || "null") as { owner: string } | null;
    if (!lease) throw new ExtensionError("Worker indisponível.", 409);
    const job = { id: randomUUID(), sourceId, runId, owner: lease.owner, status: "queued", createdAt: Date.now(), expiresAt: Date.now() + 120_000 };
    jobActive(db, { ...job, result: null, errorCode: null });
    return db.insert(companionJobs).values(job).returning().get();
  }, { behavior: "immediate" });
}
export function claimCaptureJob(db: OrbitDB) {
  return db.transaction(() => {
    const jobs = db.select().from(companionJobs).where(eq(companionJobs.status, "queued")).orderBy(asc(companionJobs.createdAt)).all();
    for (const job of jobs) {
      let source: typeof sources.$inferSelect;
      try { source = jobActive(db, job); }
      catch { db.update(companionJobs).set({ status: "expired", result: null }).where(eq(companionJobs.id, job.id)).run(); continue; }
      const platform = (Object.keys(browserSourceKinds) as BrowserPlatform[]).find(platform => browserSourceKinds[platform] === source.kind);
      if (!platform) continue;
      db.update(companionJobs).set({ status: "claimed" }).where(eq(companionJobs.id, job.id)).run();
      return { id: job.id, platform, expiresAt: job.expiresAt, maxItems: z.coerce.number().int().min(1).max(50).parse(readEnvironment().env.COLLECTOR_MAX_ITEMS || "20") };
    }
    return null;
  }, { behavior: "immediate" });
}
const rawSchema = z.object({ platform: z.enum(["youtube", "x", "instagram", "valete"]), externalId: z.string().min(1).max(200), title: z.string().min(1).max(1000), text: z.string().max(12000), author: z.string().max(200), url: z.string().max(4096), thumbnail: z.string().max(8192).nullable(), publishedAt: z.number().int().nonnegative().max(8_640_000_000_000_000).nullable(), durationSeconds: z.number().int().min(0).max(604800).nullable(), metrics: z.object({ likes: z.string().max(40).optional(), replies: z.string().max(40).optional(), reposts: z.string().max(40).optional(), views: z.string().max(40).optional() }).strict().optional(), evidence: z.enum(["rss", "youtube_home", "x_for_you", "instagram_feed", "valete_feed", "valete_dom"]).optional() }).strict();
const resultSchema = z.union([z.object({ items: z.array(rawSchema).max(50) }).strict(), z.object({ error: z.enum(["login_required", "verification_required", "layout_changed", "permission_required", "browser_unavailable", "rate_limited", "source_timeout", "source_http_error", "navigation_failed", "script_injection_failed", "capture_timeout", "user_interrupted"]), retryAfterMs: z.number().int().min(1000).max(604800000).optional() }).strict()]);
function validItem(item: z.infer<typeof rawSchema>, platform: BrowserPlatform): RawItem {
  if (item.platform !== platform) throw new ExtensionError("Plataforma incorreta.");
  const url = new URL(item.url);
  const hosts = { youtube: ["www.youtube.com", "youtube.com"], x: ["x.com", "www.x.com", "twitter.com"], instagram: ["www.instagram.com", "instagram.com"], valete: ["app.valete.org.br"] };
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts[platform].includes(url.hostname)) throw new ExtensionError("Link fora da plataforma.");
  const match = platform === "youtube" ? url.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(item.externalId) && url.searchParams.get("v") === item.externalId : platform === "x" ? /^\/[A-Za-z0-9_]{1,30}\/status\/\d{5,25}\/?$/.test(url.pathname) && url.pathname.split("/").filter(Boolean).at(-1) === item.externalId : platform === "instagram" ? /^\/(p|reel)\/[A-Za-z0-9_-]{5,30}\/?$/.test(url.pathname) && url.pathname.split("/").filter(Boolean).at(-1) === item.externalId : /^\/(a|p|post)\/[^?#]+/.test(url.pathname);
  if (!match) throw new ExtensionError("Permalink inválido.");
  url.hash = "";
  if (platform !== "youtube") url.search = "";
  else url.search = `?v=${item.externalId}`;
  let thumbnail: string | null = null;
  if (item.thumbnail) {
    try {
      const image = new URL(item.thumbnail);
      const imageHosts = { youtube: ["i.ytimg.com"], x: ["pbs.twimg.com"], instagram: ["cdninstagram.com", "fbcdn.net"], valete: ["app.valete.org.br"] };
      if (image.protocol === "https:" && !image.port && !image.username && !image.password && imageHosts[platform].some(host => image.hostname === host || (platform === "instagram" && image.hostname.endsWith(`.${host}`)))) thumbnail = image.toString();
    } catch { /* Uma capa inválida não invalida o restante do item. */ }
  }
  return { ...item, url: url.toString(), thumbnail, evidence: platform === "valete" && item.evidence === "valete_dom" ? "valete_dom" : browserSourceKinds[platform] };
}
export function completeCaptureJob(db: OrbitDB, id: string, input: unknown) {
  const payload = resultSchema.parse(input);
  return db.transaction(() => {
    const job = db.select().from(companionJobs).where(eq(companionJobs.id, id)).get();
    if (!job || job.status !== "claimed") throw new ExtensionError("Pedido não disponível.", 409);
    const source = jobActive(db, job);
    if ("error" in payload) {
      db.update(companionJobs).set({ status: "error", result: null, errorCode: payload.error }).where(eq(companionJobs.id, id)).run();
      if (payload.error === "rate_limited") db.update(sources).set({ cooldownUntil: Date.now() + (payload.retryAfterMs || 900000) }).where(eq(sources.id, source.id)).run();
      return;
    }
    const max = z.coerce.number().int().min(1).max(50).parse(readEnvironment().env.COLLECTOR_MAX_ITEMS || "20");
    if (payload.items.length > max) throw new ExtensionError("Quantidade acima do limite.");
    if (!Object.hasOwn(browserSourceKinds, source.platform)) throw new ExtensionError("Essa fonte não é coletada pelo navegador.");
    const platform = source.platform as BrowserPlatform;
    const items = payload.items.map(item => validItem(item, platform));
    db.update(companionJobs).set({ status: "completed", result: items, errorCode: null }).where(eq(companionJobs.id, id)).run();
  }, { behavior: "immediate" });
}
export function rejectCaptureJob(db: OrbitDB, id: string) {
  db.transaction(() => {
    const job = db.select().from(companionJobs).where(eq(companionJobs.id, id)).get();
    if (!job || job.status !== "claimed") return;
    try { jobActive(db, job); } catch { return; }
    db.update(companionJobs).set({ status: "error", result: null, errorCode: "layout_changed" }).where(eq(companionJobs.id, id)).run();
  }, { behavior: "immediate" });
}
export function captureResult(db: OrbitDB, id: string): RawItem[] | null {
  const job = db.select().from(companionJobs).where(eq(companionJobs.id, id)).get();
  if (!job) throw new CollectorError("browser_unavailable", "Pedido de coleta não encontrado.");
  if (job.status === "completed") return job.result || [];
  const messages: Record<string, string> = { source_timeout: "Valete+ excedeu 15 segundos na consulta à API. Tente novamente mais tarde; isso não prova que a sessão expirou.", source_http_error: "A consulta do Valete+ falhou na rede ou retornou erro HTTP. A sessão não foi invalidada automaticamente.", navigation_failed: "A extensão não conseguiu carregar a página do feed. Abra o site no mesmo perfil do Helium e confira o login.", script_injection_failed: "O navegador recusou o leitor da extensão nesta página. Confira o login e a permissão de acesso ao site nas configurações da extensão.", capture_timeout: "A captura excedeu 45 segundos. A aba de coleta foi encerrada; tente novamente mais tarde.", user_interrupted: "Coleta interrompida porque você assumiu a aba criada pela extensão. Sua aba foi preservada. Solicite outra atualização sem ativar a aba de coleta.", login_required: "Entre normalmente no site pelo Helium e tente novamente.", verification_required: "A plataforma pediu verificação. Resolva o fluxo normal manualmente no navegador.", permission_required: "Autorize o acesso da extensão a essa plataforma nas configurações do Helium.", layout_changed: "A extensão não reconheceu o feed. Confira a página e os seletores.", companion_required: "Conecte novamente a extensão em /conectar.", rate_limited: "A plataforma pediu redução de frequência; o Retry-After foi preservado." };
  if (job.status === "error") throw new CollectorError(job.errorCode === "login_required" || job.errorCode === "verification_required" || job.errorCode === "layout_changed" || job.errorCode === "rate_limited" || job.errorCode === "source_timeout" || job.errorCode === "source_http_error" || job.errorCode === "navigation_failed" || job.errorCode === "script_injection_failed" || job.errorCode === "capture_timeout" || job.errorCode === "user_interrupted" ? job.errorCode : "browser_unavailable", messages[job.errorCode || ""] || "A extensão não concluiu a coleta. Abra o Helium e tente novamente.", job.errorCode === "rate_limited" ? Math.max(1000, (db.select().from(sources).where(eq(sources.id, job.sourceId)).get()?.cooldownUntil || Date.now() + 900000) - Date.now()) : undefined);
  if (job.expiresAt <= Date.now()) throw new CollectorError("browser_unavailable", "A extensão não respondeu em dois minutos. Abra o Helium e confira a conexão.");
  return null;
}
