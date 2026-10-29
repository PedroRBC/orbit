import { createECDH, createHash, ECDH } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import webPush from "web-push";
import type { OrbitDB } from "../db/index";
import { pushDeliveries, pushSubscriptions } from "../db/push-schema";
import { getSetting, setSetting, workerOnline } from "./store";
import { isPublicAddress, publicFeedURL } from "./public-feed";
import { readEnvironment } from "./ai-environment";

const TTL = 3600;
const subjectMessage = "Configure ORBIT_PUSH_SUBJECT com um contato mailto: ou HTTPS válido no servidor para ativar notificações.";
const invalidSubscription = "Inscrição de notificação inválida ou provedor não suportado.";
export class PushError extends Error {}
export type PushConfiguration = {
  publicKey: string | null;
  subscribed: boolean;
  message: string;
  contact: "ok" | "ausente" | "inválido";
  workerOnline: boolean;
  lastDelivery: { kind: "test" | "edition"; status: string; at: number } | null;
};

function endpointURL(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) throw new PushError(invalidSubscription);
  let url: URL;
  try { url = new URL(value); } catch { throw new PushError(invalidSubscription); }
  const paths: Record<string, RegExp> = {
    "fcm.googleapis.com": /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:\-]+$/,
    "updates.push.services.mozilla.com": /^\/wpush\/v2\/[A-Za-z0-9_\-]+$/,
    "web.push.apple.com": /^\/[A-Za-z0-9_\-]+$/,
  };
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.href !== value || !Object.hasOwn(paths, url.hostname) || !paths[url.hostname].test(url.pathname)) throw new PushError(invalidSubscription);
  return url;
}
const subscriptionSchema = z.object({
  endpoint: z.string().max(2048),
  expirationTime: z.number().int().nonnegative().safe().nullable().optional(),
  keys: z.object({ p256dh: z.string().length(87), auth: z.string().length(22) }).strict(),
}).strict();
function keyBytes(value: string, length: number) {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) throw new PushError(invalidSubscription);
  return bytes;
}
function parseSubscription(serialized: unknown) {
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 4096) throw new PushError(invalidSubscription);
  try {
    const value = subscriptionSchema.parse(JSON.parse(serialized));
    endpointURL(value.endpoint);
    const publicKey = keyBytes(value.keys.p256dh, 65);
    if (publicKey[0] !== 4) throw new PushError(invalidSubscription);
    ECDH.convertKey(publicKey, "prime256v1"); keyBytes(value.keys.auth, 16);
    if (value.expirationTime !== undefined && value.expirationTime !== null && value.expirationTime <= Date.now()) throw new PushError(invalidSubscription);
    return value;
  } catch { throw new PushError(invalidSubscription); }
}
export function subject(env: Record<string, string | undefined> = readEnvironment().env) {
  const value = env.ORBIT_PUSH_SUBJECT || "";
  if (!value || value.length > 512 || /[\s\x00-\x1f\x7f]/.test(value)) throw new PushError(subjectMessage);
  if (/^mailto:[a-z0-9._+\-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value)) return value;
  try {
    if (new URL(value).hash) throw new Error();
    return publicFeedURL(value).href;
  } catch { throw new PushError(subjectMessage); }
}
function vapidKeys(db: OrbitDB) {
  return db.transaction(() => {
    const stored = getSetting(db, "push_vapid");
    if (!stored) {
      if (db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).get()) throw new PushError("Restaure as chaves VAPID originais do backup antes de enviar notificações para os aparelhos já inscritos.");
      const keys = webPush.generateVAPIDKeys();
      setSetting(db, "push_vapid", JSON.stringify(keys));
      return keys;
    }
    try {
      const keys = JSON.parse(stored) as { publicKey: string; privateKey: string };
      const key = createECDH("prime256v1"); key.setPrivateKey(keyBytes(keys.privateKey, 32));
      if (key.getPublicKey().toString("base64url") !== keys.publicKey) throw new Error();
      return { publicKey: keys.publicKey, privateKey: keys.privateKey };
    } catch { throw new PushError("Chaves de notificação indisponíveis. Restaure o banco com as chaves VAPID originais; elas não são substituídas automaticamente."); }
  }, { behavior: "immediate" });
}
const subscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
export function pushConfiguration(db: OrbitDB, endpoint: unknown = null): PushConfiguration {
  let id: string | undefined;
  try { id = subscriptionId(endpointURL(endpoint).href); } catch { /* Endpoint local não suportado não impede consultar a configuração. */ }
  const subscribed = id ? !!db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get() : false;
  const delivery = id ? db.select({ kind: pushDeliveries.kind, status: pushDeliveries.status, createdAt: pushDeliveries.createdAt, attemptedAt: pushDeliveries.attemptedAt }).from(pushDeliveries).where(eq(pushDeliveries.subscriptionId, id)).orderBy(desc(pushDeliveries.id)).get() : undefined;
  const state = { subscribed, workerOnline: workerOnline(db), lastDelivery: delivery ? { kind: delivery.kind, status: delivery.status, at: delivery.attemptedAt ?? delivery.createdAt } : null };
  const { env } = readEnvironment();
  let contact: PushConfiguration["contact"] = env.ORBIT_PUSH_SUBJECT ? "inválido" : "ausente";
  try {
    subject(env); contact = "ok";
    return { ...state, contact, publicKey: vapidKeys(db).publicKey, message: "Notificações opcionais, discretas e por aparelho. Nenhuma manchete aparece na tela bloqueada." };
  } catch (error) {
    return { ...state, contact, publicKey: null, message: error instanceof PushError ? error.message : "Não foi possível consultar as notificações." };
  }
}
export function savePushSubscription(db: OrbitDB, serialized: unknown): void {
  const value = parseSubscription(serialized);
  subject(); vapidKeys(db);
  db.transaction(() => {
    const id = subscriptionId(value.endpoint);
    const exists = db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get();
    if (!exists && db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).all().length >= 10) throw new PushError("Limite de dez aparelhos. Desative notificações em outro aparelho antes de adicionar este.");
    db.insert(pushSubscriptions).values({ id, endpoint: value.endpoint, ...value.keys, createdAt: Date.now() }).onConflictDoUpdate({ target: pushSubscriptions.id, set: value.keys }).run();
  }, { behavior: "immediate" });
}
function removeSubscription(db: OrbitDB, id: string) {
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
  db.update(pushDeliveries).set({ status: "cancelled" }).where(and(eq(pushDeliveries.subscriptionId, id), eq(pushDeliveries.status, "queued"))).run();
}
export function removePushSubscription(db: OrbitDB, endpoint: unknown): void {
  let id: string;
  try { id = subscriptionId(endpointURL(endpoint).href); } catch { return; }
  db.transaction(() => removeSubscription(db, id), { behavior: "immediate" });
}
function editionURL(editionId: number) {
  if (!Number.isSafeInteger(editionId) || editionId <= 0) throw new PushError("Edição inválida para notificação.");
  return `/briefings/${editionId}`;
}
// O chamador já persiste a edição e verifica seu lease na mesma transação.
export function queueEditionPush(db: OrbitDB, editionId: number): void {
  editionURL(editionId);
  for (const subscription of db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).all()) {
    db.insert(pushDeliveries).values({ subscriptionId: subscription.id, editionId, kind: "edition", createdAt: Date.now() }).onConflictDoNothing().run();
  }
}
export function queuePushTest(db: OrbitDB, endpoint: unknown, editionId: number | null): void {
  const id = subscriptionId(endpointURL(endpoint).href);
  if (editionId !== null) editionURL(editionId);
  subject();
  db.transaction(() => {
    if (!db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get()) throw new PushError("Ative as notificações neste aparelho antes de testar.");
    const now = Date.now();
    const recent = (JSON.parse(getSetting(db, "push_test_times") || "[]") as number[]).filter(time => time > now - 3600_000);
    if (recent.some(time => now - time < 60_000)) throw new PushError("Aguarde um minuto entre testes de notificação.");
    if (recent.length >= 5) throw new PushError("Limite de cinco testes por hora, somando todos os aparelhos.");
    setSetting(db, "push_test_times", JSON.stringify([...recent, now]));
    db.insert(pushDeliveries).values({ subscriptionId: id, editionId: editionId ?? 0, kind: "test", createdAt: now }).run();
  }, { behavior: "immediate" });
}
async function sendPush(details: webPush.RequestDetails, assertActive: () => void, externalSignal?: AbortSignal) {
  const url = endpointURL(details.endpoint);
  const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(externalSignal ? [externalSignal] : [])]);
  signal.throwIfAborted();
  let abort: () => void = () => {};
  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new PushError("Envio de notificação interrompido."));
      signal.addEventListener("abort", abort, { once: true });
    });
    addresses = await Promise.race([lookup(url.hostname, { all: true, verbatim: true }), cancelled]);
  } finally { signal.removeEventListener("abort", abort); }
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new PushError("Provedor de notificação indisponível.");
  signal.throwIfAborted(); assertActive();
  const address = addresses[0];
  return new Promise<number>((resolve, reject) => {
    const req = request({ hostname: address.address, family: address.family, port: 443, servername: url.hostname, checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate), method: "POST", path: url.pathname, headers: { ...details.headers, Host: url.hostname }, agent: false, rejectUnauthorized: true, signal }, incoming => {
      incoming.once("error", reject);
      // Só o status interessa: não ler corpo nem seguir Location, mesmo em erro.
      const status = incoming.statusCode || 0; incoming.destroy(); resolve(status);
    });
    req.once("error", reject); req.end(details.body);
  });
}
export async function drainPush(db: OrbitDB, assertActive: () => void, signal?: AbortSignal): Promise<void> {
  const check = () => { signal?.throwIfAborted(); assertActive(); };
  const owned = <T>(operation: () => T) => db.transaction(() => { check(); return operation(); }, { behavior: "immediate" });
  check();
  if (!db.select({ id: pushDeliveries.id }).from(pushDeliveries).where(eq(pushDeliveries.status, "queued")).get()) return;
  owned(() => db.update(pushDeliveries).set({ status: "expired" }).where(and(eq(pushDeliveries.status, "queued"), lte(pushDeliveries.createdAt, Date.now() - TTL * 1000))).run());
  let vapidDetails: { subject: string; publicKey: string; privateKey: string };
  try {
    const contact = subject();
    vapidDetails = owned(() => ({ subject: contact, ...vapidKeys(db) }));
  } catch { check(); return; }
  for (let index = 0; index < 20; index++) {
    const claimed = owned(() => {
      const delivery = db.select().from(pushDeliveries).where(eq(pushDeliveries.status, "queued")).orderBy(asc(pushDeliveries.id)).get();
      if (!delivery) return null;
      const expired = delivery.createdAt + TTL * 1000 <= Date.now();
      const subscription = expired ? undefined : db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, delivery.subscriptionId)).get();
      // shortcut: claim pode perder avisos em quedas; só retentar com deduplicação garantida pelo provedor.
      db.update(pushDeliveries).set({ status: expired ? "expired" : subscription ? "attempted" : "cancelled", attemptedAt: Date.now() }).where(eq(pushDeliveries.id, delivery.id)).run();
      return { delivery, subscription };
    });
    if (!claimed) return;
    const { delivery, subscription } = claimed;
    if (!subscription) continue;
    const currentSubscription = and(eq(pushSubscriptions.id, subscription.id), eq(pushSubscriptions.p256dh, subscription.p256dh), eq(pushSubscriptions.auth, subscription.auth));
    let failureStatus: "failed" | "expired" | "cancelled" = "failed";
    const boundary = () => {
      check();
      if (delivery.createdAt + TTL * 1000 <= Date.now()) { failureStatus = "expired"; throw new PushError("Notificação vencida."); }
      if (!db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(currentSubscription).get()) { failureStatus = "cancelled"; throw new PushError("Notificações desativadas neste aparelho."); }
    };
    let status = 0;
    try {
      boundary();
      const input = parseSubscription(JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }));
      const test = delivery.kind === "test";
      const payload = JSON.stringify({ url: test && delivery.editionId === 0 ? "/briefings" : editionURL(delivery.editionId), test });
      if (Buffer.byteLength(payload) > 512) throw new PushError("Notificação excede o limite.");
      const remainingTTL = Math.max(1, Math.min(TTL, Math.floor((delivery.createdAt + TTL * 1000 - Date.now()) / 1000)));
      const details = webPush.generateRequestDetails(input, payload, { vapidDetails, TTL: remainingTTL, urgency: "normal", contentEncoding: "aes128gcm" });
      if (!details.body || details.body.length > 4096) throw new PushError("Notificação excede o limite.");
      boundary(); status = await sendPush(details, boundary, signal);
    } catch { check(); }
    owned(() => {
      db.update(pushDeliveries).set({ status: status >= 200 && status < 300 ? "sent" : failureStatus }).where(eq(pushDeliveries.id, delivery.id)).run();
      if ((status === 404 || status === 410) && db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(currentSubscription).get()) removeSubscription(db, subscription.id);
    });
  }
}
