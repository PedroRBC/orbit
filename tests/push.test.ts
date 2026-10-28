import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import { eq } from "drizzle-orm";
import webPush from "web-push";

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
const session = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("../src/lib/session", () => ({ requireSession: session.require }));
import { openDatabase, type OrbitDB } from "../src/db/index";
import * as databaseModule from "../src/db/index";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { createSession, sessionCookie } from "../src/lib/auth";
import { pushDeliveries, pushSubscriptions } from "../src/db/push-schema";
import { getSetting, setSetting } from "../src/lib/store";
import { drainPush, pushConfiguration, queueEditionPush, queuePushTest, removePushSubscription, savePushSubscription } from "../src/lib/push";
import { getPushConfiguration, subscribePush, testPush, unsubscribePush } from "../src/app/push-actions";

const databases: OrbitDB[] = [];
const directories: string[] = [];
function database(path = ":memory:") {
  const db = openDatabase(path); databases.push(db);
  // Fixture da migração de integração; o código de produção nunca cria tabelas em runtime.
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, subscriptionId TEXT NOT NULL, editionId INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'edition', status TEXT NOT NULL DEFAULT 'queued', createdAt INTEGER NOT NULL, attemptedAt INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS push_deliveries_edition ON push_deliveries (subscriptionId, editionId) WHERE kind = 'edition';
    CREATE INDEX IF NOT EXISTS push_deliveries_status ON push_deliveries (status, id);
  `);
  return db;
}
function subscription(token = "synthetic-token") {
  const key = createECDH("prime256v1"); key.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${token}`, expirationTime: null, keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}
function subscribed() {
  const db = database(), input = subscription();
  savePushSubscription(db, JSON.stringify(input));
  return { db, input };
}
function respond(status = 201) {
  network.request.mockImplementation((_options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    req.end = vi.fn(() => queueMicrotask(() => {
      const incoming = new Readable({ read() {} }) as Readable & { statusCode: number; headers: Record<string, string> };
      incoming.statusCode = status; incoming.headers = { location: "https://127.0.0.1/private" };
      callback(incoming); incoming.push(null);
    }));
    req.destroy = vi.fn();
    return req;
  });
}
beforeEach(() => {
  vi.clearAllMocks(); session.require.mockResolvedValue(undefined);
  vi.stubEnv("ORBIT_PUSH_SUBJECT", "mailto:orbit@example.com");
  network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); respond();
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.$client.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("configuração e inscrições Web Push", () => {
  it("gera VAPID uma vez, persiste e só devolve a chave pública", () => {
    const db = database();
    const first = pushConfiguration(db);
    const stored = getSetting(db, "push_vapid");
    expect(first.publicKey).toHaveLength(87);
    expect(pushConfiguration(db)).toEqual(first);
    expect(getSetting(db, "push_vapid")).toBe(stored);
    const keys = JSON.parse(stored!);
    expect(keys.privateKey).toHaveLength(43);
    expect(JSON.stringify(first)).not.toContain(keys.privateKey);
    expect(JSON.stringify(first)).not.toContain("mailto:");
  });
  it.each(["", "mailto:invalid", "http://example.com", "https://localhost", "https://user:secret@example.com", "mailto:orbit@example.com\n"])("mostra contato ausente/inválido sem enviar: %j", async subject => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    vi.stubEnv("ORBIT_PUSH_SUBJECT", subject);
    expect(pushConfiguration(db).publicKey).toBeNull();
    expect(pushConfiguration(db).message).toContain("ORBIT_PUSH_SUBJECT");
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("queued");
  });
  it("não substitui silenciosamente chaves VAPID danificadas", () => {
    const db = database(); setSetting(db, "push_vapid", '{"publicKey":"invalid","privateKey":"secret"}');
    const state = pushConfiguration(db);
    expect(state.publicKey).toBeNull(); expect(state.message).not.toContain("secret");
    expect(getSetting(db, "push_vapid")).toContain("secret");
  });
  it("aceita contato HTTPS e não troca VAPID se as chaves sumirem com inscrições ativas", () => {
    const { db } = subscribed();
    vi.stubEnv("ORBIT_PUSH_SUBJECT", "https://example.com/contato");
    expect(pushConfiguration(db).publicKey).toHaveLength(87);
    db.$client.prepare("DELETE FROM settings WHERE key = 'push_vapid'").run();
    expect(pushConfiguration(db).publicKey).toBeNull();
    expect(getSetting(db, "push_vapid")).toBeUndefined();
  });
  it("aceita só provedores HTTPS conhecidos e chaves de curva válidas", () => {
    const db = database(), input = subscription();
    for (const endpoint of [input.endpoint, "https://fcm.googleapis.com/wp/token", "https://updates.push.services.mozilla.com/wpush/v2/token", "https://web.push.apple.com/token"]) {
      savePushSubscription(db, JSON.stringify({ ...input, endpoint }));
    }
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(4);
    for (const endpoint of ["http://fcm.googleapis.com/fcm/send/token", "https://fcm.googleapis.com.evil.test/fcm/send/token", "https://evil.fcm.googleapis.com/fcm/send/token", "https://fcm.googleapis.com./fcm/send/token", "https://user:secret@fcm.googleapis.com/fcm/send/token", "https://fcm.googleapis.com:8443/fcm/send/token", "https://127.0.0.1/fcm/send/token", "https://fcm.googleapis.com/other/token", "https://fcm.googleapis.com/fcm/send/token?redirect=private", "https://web.push.apple.com/token#private", "https://fcm.googleapis.com/fcm/send/../private", "https://fcm.googleapis.com/fcm/send/to%2fken", "https://fcm.googleapis.com/fcm/send/token\n"]) {
      expect(() => savePushSubscription(db, JSON.stringify({ ...input, endpoint }))).toThrow();
    }
    expect(() => savePushSubscription(db, JSON.stringify({ ...input, keys: { ...input.keys, auth: "short" } }))).toThrow();
    expect(() => savePushSubscription(db, JSON.stringify({ ...input, keys: { ...input.keys, p256dh: Buffer.alloc(65).toString("base64url") } }))).toThrow();
    expect(() => savePushSubscription(db, JSON.stringify({ ...input, expirationTime: Date.now() - 1 }))).toThrow();
    expect(() => savePushSubscription(db, JSON.stringify({ ...input, cookie: "not-allowed" }))).toThrow();
    expect(() => savePushSubscription(db, "x".repeat(4097))).toThrow();
    expect(network.lookup).not.toHaveBeenCalled();
  });
  it("limita dez aparelhos, mantém cadastro idempotente e não devolve endpoints", () => {
    const { db, input } = subscribed();
    for (let index = 1; index < 10; index++) savePushSubscription(db, JSON.stringify(subscription(`device-${index}`)));
    expect(() => savePushSubscription(db, JSON.stringify(subscription("device-11")))).toThrow(/dez/);
    savePushSubscription(db, JSON.stringify(input));
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(10);
    expect(pushConfiguration(db, input.endpoint).subscribed).toBe(true);
    expect(JSON.stringify(pushConfiguration(db, input.endpoint))).not.toContain(input.endpoint);
    removePushSubscription(db, input.endpoint);
    expect(pushConfiguration(db, input.endpoint).subscribed).toBe(false);
  });
});

describe("outbox de edições e envio at-most-once", () => {
  it("a fila acompanha rollback da edição e é única por inscrição/edição", () => {
    const { db } = subscribed();
    expect(() => db.transaction(() => { queueEditionPush(db, 1); throw new Error("rollback"); })).toThrow();
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
    db.transaction(() => { queueEditionPush(db, 1); queueEditionPush(db, 1); });
    expect(db.select().from(pushDeliveries).all()).toHaveLength(1);
    for (const id of [0, -1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => queueEditionPush(db, id)).toThrow();
  });
  it("envia conteúdo genérico criptografado, TTL limitado e IP pinado com SNI original", async () => {
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const { db } = subscribed(); queueEditionPush(db, 42);
    const details = vi.spyOn(webPush, "generateRequestDetails");
    await drainPush(db, () => {});
    expect(details.mock.calls[0][1]).toBe(JSON.stringify({ url: "/briefings/42", test: false }));
    expect(details.mock.calls[0][2]).toMatchObject({ TTL: 3600, contentEncoding: "aes128gcm", urgency: "normal" });
    expect(network.request.mock.calls[0][0]).toMatchObject({ hostname: "8.8.8.8", family: 4, servername: "fcm.googleapis.com", method: "POST", port: 443, rejectUnauthorized: true, agent: false, headers: { Host: "fcm.googleapis.com", TTL: 3600, "Content-Encoding": "aes128gcm" } });
    expect(network.request.mock.results[0].value.end.mock.calls[0][0]).toBeInstanceOf(Buffer);
    expect(db.select().from(pushDeliveries).get()).toMatchObject({ status: "sent", editionId: 42 });
    await drainPush(db, () => {}); queueEditionPush(db, 42); await drainPush(db, () => {});
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("envia para o formato Chrome FCM /wp/<token> com host estrito", async () => {
    const db = database(), input = { ...subscription(), endpoint: "https://fcm.googleapis.com/wp/synthetic-token" };
    savePushSubscription(db, JSON.stringify(input)); queueEditionPush(db, 42);
    await drainPush(db, () => {});
    expect(network.request.mock.calls[0][0]).toMatchObject({ path: "/wp/synthetic-token", servername: "fcm.googleapis.com", headers: { Host: "fcm.googleapis.com" } });
    expect(db.select().from(pushDeliveries).get()?.status).toBe("sent");
  });
  it.each([404, 410])("remove inscrição expirada %i e cancela outras entregas", async status => {
    const { db } = subscribed(); queueEditionPush(db, 1); queueEditionPush(db, 2); respond(status);
    await drainPush(db, () => {});
    expect(db.select().from(pushSubscriptions).all()).toEqual([]);
    expect(db.select().from(pushDeliveries).all().map(row => row.status)).toEqual(["failed", "cancelled"]);
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it.each([302, 429, 500])("não segue redirects nem repete respostas %i", async status => {
    const { db } = subscribed(); queueEditionPush(db, 1); respond(status);
    await drainPush(db, () => {}); await drainPush(db, () => {});
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(db.select().from(pushDeliveries).get()?.status).toBe("failed");
  });
  it("não repete erro de transporte ambíguo ou claim persistido antes de queda", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    network.request.mockImplementation(() => { throw new Error("secret endpoint/provider error"); });
    await drainPush(db, () => {}); await drainPush(db, () => {});
    expect(network.request).toHaveBeenCalledTimes(1);
    queueEditionPush(db, 2);
    db.update(pushDeliveries).set({ status: "attempted", attemptedAt: Date.now() }).where(eq(pushDeliveries.editionId, 2)).run();
    await drainPush(db, () => {});
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("mantém o claim, a unicidade e VAPID ao reabrir o SQLite depois de uma queda", async () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-push-")); directories.push(directory);
    const path = join(directory, "synthetic.db"), db = database(path), input = subscription();
    savePushSubscription(db, JSON.stringify(input)); queueEditionPush(db, 42);
    const key = pushConfiguration(db).publicKey;
    db.update(pushDeliveries).set({ status: "attempted", attemptedAt: Date.now() }).run();
    db.$client.close(); databases.splice(databases.indexOf(db), 1);
    const reopened = database(path); queueEditionPush(reopened, 42);
    await drainPush(reopened, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(reopened.select().from(pushDeliveries).all()).toHaveLength(1);
    expect(pushConfiguration(reopened).publicKey).toBe(key);
  });
  it("preserva tombstones ao desativar e reativar o mesmo endpoint", async () => {
    const { db, input } = subscribed(); queueEditionPush(db, 1);
    removePushSubscription(db, input.endpoint); savePushSubscription(db, JSON.stringify(input)); queueEditionPush(db, 1);
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).all()).toHaveLength(1);
  });
  it("descarta edições vencidas em vez de enviar notificações antigas", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    vi.setSystemTime(Date.now() + 3600_001);
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("expired");
  });
  it("bloqueia DNS privado/misto, sem abrir socket ou reconsultar DNS no envio", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("failed");
  });
  it("não envia se o aparelho foi desativado enquanto resolvia DNS", async () => {
    const { db, input } = subscribed(); queueEditionPush(db, 1);
    network.lookup.mockImplementation(async () => { removePushSubscription(db, input.endpoint); return [{ address: "8.8.8.8", family: 4 }]; });
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
  });
  it("não remove uma inscrição renovada por causa de resposta 410 da antiga", async () => {
    const { db, input } = subscribed(); queueEditionPush(db, 1); respond(410);
    const send = network.request.getMockImplementation()!;
    network.request.mockImplementation((options, callback) => send(options, (response: unknown) => { savePushSubscription(db, JSON.stringify(subscription())); callback(response); }));
    await drainPush(db, () => {});
    expect(pushConfiguration(db, input.endpoint).subscribed).toBe(true);
  });
  it("nenhum claim ou ajuste é gravado sem lease ativo", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    let calls = 0;
    await expect(drainPush(db, () => { if (++calls >= 2) throw new Error("lease perdido"); })).rejects.toThrow("lease perdido");
    expect(db.select().from(pushDeliveries).get()?.status).toBe("queued");
    expect(network.lookup).not.toHaveBeenCalled();
  });
  it("verifica lease dentro do claim e após DNS, antes do socket", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    const transactions: boolean[] = [];
    let lost = false;
    const assertActive = () => { transactions.push(db.$client.inTransaction); if (lost) throw new Error("lease perdido"); };
    network.lookup.mockImplementation(async () => { lost = true; return [{ address: "8.8.8.8", family: 4 }]; });
    await expect(drainPush(db, assertActive)).rejects.toThrow("lease perdido");
    expect(transactions).toContain(true);
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("attempted");
    lost = false; await drainPush(db, assertActive);
    expect(network.request).not.toHaveBeenCalled();
  });
  it("não finaliza entrega após perda do lease na resposta", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    let lost = false;
    respond();
    const send = network.request.getMockImplementation()!;
    network.request.mockImplementation((options, callback) => send(options, (response: unknown) => { lost = true; callback(response); }));
    await expect(drainPush(db, () => { if (lost) throw new Error("lease perdido"); })).rejects.toThrow("lease perdido");
    expect(db.select().from(pushDeliveries).get()?.status).toBe("attempted");
  });
  it("respeita cancelamento antes do claim e durante DNS", async () => {
    const { db } = subscribed(); queueEditionPush(db, 1);
    const controller = new AbortController(); controller.abort();
    await expect(drainPush(db, () => {}, controller.signal)).rejects.toThrow();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("queued");
    const inFlight = new AbortController();
    network.lookup.mockImplementation(() => { inFlight.abort(); return new Promise(() => {}); });
    await expect(drainPush(db, () => {}, inFlight.signal)).rejects.toThrow();
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("attempted");
  });
  it.each([{ editionId: null, storedId: 0, url: "/briefings" }, { editionId: 42, storedId: 42, url: "/briefings/42" }])("teste aceita edição $editionId e envia destino fixo $url", async ({ editionId, storedId, url }) => {
    const { db, input } = subscribed();
    const details = vi.spyOn(webPush, "generateRequestDetails");
    queuePushTest(db, input.endpoint, editionId);
    expect(db.select().from(pushDeliveries).get()).toMatchObject({ kind: "test", editionId: storedId, status: "queued" });
    await drainPush(db, () => {});
    expect(details.mock.calls[0][1]).toBe(JSON.stringify({ url, test: true }));
    expect(db.select().from(pushDeliveries).get()?.status).toBe("sent");
  });
  it("zero explícito não é aceito como edição do teste nem da publicação", () => {
    const { db, input } = subscribed();
    expect(() => queuePushTest(db, input.endpoint, 0)).toThrow(/Edição inválida/);
    expect(() => queueEditionPush(db, 0)).toThrow(/Edição inválida/);
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
    expect(getSetting(db, "push_test_times")).toBeUndefined();
  });
  it("zero interno nunca permite enviar uma notificação de edição", async () => {
    const { db } = subscribed(), subscription = db.select().from(pushSubscriptions).get()!;
    db.insert(pushDeliveries).values({ subscriptionId: subscription.id, editionId: 0, kind: "edition", createdAt: Date.now() }).run();
    await drainPush(db, () => {});
    expect(network.request).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).get()?.status).toBe("failed");
  });
  it("testes entram na fila, com limite persistente de um/minuto e cinco/hora", async () => {
    const { db, input } = subscribed();
    queuePushTest(db, input.endpoint, null);
    expect(() => queuePushTest(db, input.endpoint, 1)).toThrow(/minuto/);
    for (let index = 1; index < 5; index++) { vi.setSystemTime(Date.now() + 60_001); queuePushTest(db, input.endpoint, 1); }
    vi.setSystemTime(Date.now() + 60_001);
    removePushSubscription(db, input.endpoint); savePushSubscription(db, JSON.stringify(input));
    expect(() => queuePushTest(db, input.endpoint, 1)).toThrow(/hora/);
    expect(db.select().from(pushDeliveries).all()).toHaveLength(5);
    expect(network.request).not.toHaveBeenCalled();
  });
});

describe("Server Actions protegidas", () => {
  it("ação enfileira teste sem primeira edição, mas recusa ID zero explícito", async () => {
    const { db, input } = subscribed(); vi.spyOn(databaseModule, "getDatabase").mockReturnValue(db);
    expect(await testPush(input.endpoint, 0)).toMatchObject({ error: true });
    expect(db.select().from(pushDeliveries).all()).toEqual([]);
    expect(await testPush(input.endpoint, null)).toMatchObject({ message: expect.stringContaining("Teste na fila") });
    expect(db.select().from(pushDeliveries).get()).toMatchObject({ kind: "test", editionId: 0 });
  });
  it("retorna mensagens sanitizadas mesmo se banco ou transporte expuser erro sensível", async () => {
    vi.spyOn(databaseModule, "getDatabase").mockImplementation(() => { throw new Error("secret-endpoint-and-key"); });
    const results = await Promise.all([getPushConfiguration(), subscribePush("invalid"), unsubscribePush("invalid"), testPush("invalid", 1)]);
    expect(JSON.stringify(results)).not.toContain("secret-endpoint-and-key");
    expect(results[1]).toMatchObject({ error: true });
  });
  it("mantém o proxy recusando POST sem sessão e CSRF na página do painel", () => {
    const db = database(); vi.spyOn(databaseModule, "getDatabase").mockReturnValue(db);
    const token = createSession(db);
    const post = (headers: Record<string, string>) => proxy(new NextRequest("http://127.0.0.1:3000/configuracoes", { method: "POST", headers: { Host: "127.0.0.1:3000", "Next-Action": "synthetic-push-action", ...headers } }));
    expect(post({ Origin: "http://127.0.0.1:3000" }).status).toBe(401);
    expect(post({ Origin: "https://evil.example", Cookie: `${sessionCookie}=${token}` }).status).toBe(403);
    expect(post({ "Sec-Fetch-Site": "cross-site", Cookie: `${sessionCookie}=${token}` }).status).toBe(403);
    expect(post({ Origin: "http://127.0.0.1:3000", Cookie: `${sessionCookie}=${token}` }).headers.get("x-middleware-next")).toBe("1");
  });
  it("todas exigem sessão antes de validar entradas ou consultar o banco", async () => {
    session.require.mockRejectedValue(new Error("sessão necessária"));
    for (const action of [() => getPushConfiguration(), () => subscribePush("invalid"), () => unsubscribePush("invalid"), () => testPush("invalid", 0)]) {
      await expect(action()).rejects.toThrow("sessão necessária");
    }
    expect(session.require).toHaveBeenCalledTimes(4);
    const source = readFileSync("src/app/push-actions.ts", "utf8");
    const actions = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
    expect(actions).toHaveLength(4);
    for (const [, , firstLine] of actions) expect(firstLine.trim()).toBe("await requireSession();");
  });
});

type WorkerEvent = { data?: { text: () => string }; notification?: { data: unknown; close: ReturnType<typeof vi.fn> }; waitUntil: (work: Promise<unknown>) => void };
function worker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined), openWindow = vi.fn().mockResolvedValue(undefined), focus = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const cache = { add: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn(), match: vi.fn() };
  class WorkerRequest extends Request {
    constructor(input: string, options?: RequestInit) { super(new URL(input, "https://orbit.example.com"), options); }
  }
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self: { location: { origin: "https://orbit.example.com" }, registration: { showNotification }, clients: { openWindow, matchAll, claim: vi.fn().mockResolvedValue(undefined) }, skipWaiting: vi.fn().mockResolvedValue(undefined), addEventListener: (name: string, callback: (event: WorkerEvent) => void) => handlers.set(name, callback) }, URL, Number, Request: WorkerRequest, caches, fetch: vi.fn().mockRejectedValue(new Error("offline")) });
  const dispatch = async (type: string, data: Omit<WorkerEvent, "waitUntil">) => {
    const work: Promise<unknown>[] = []; handlers.get(type)!({ ...data, waitUntil: value => { work.push(value); } }); await Promise.all(work);
  };
  return { dispatch, showNotification, openWindow, focus, matchAll, caches, cache };
}
describe("service worker sem cache pessoal", () => {
  it("mostra só mensagem discreta e abre a edição sem nenhuma janela aberta", async () => {
    const sw = worker();
    await sw.dispatch("push", { data: { text: () => JSON.stringify({ url: "/briefings/42", title: "segredo", body: "manchete privada", test: false }) } });
    expect(sw.showNotification).toHaveBeenCalledWith("Orbit", expect.objectContaining({ body: "Uma nova edição está disponível.", data: { url: "/briefings/42", test: false } }));
    const close = vi.fn();
    await sw.dispatch("notificationclick", { notification: { data: { url: "/briefings/42" }, close } });
    expect(close).toHaveBeenCalledOnce();
    expect(sw.openWindow).toHaveBeenCalledWith("https://orbit.example.com/briefings/42");
    expect(sw.caches.open).not.toHaveBeenCalled();
  });
  it("teste sem edição abre o arquivo, persistindo e revalidando a flag no clique", async () => {
    const sw = worker();
    await sw.dispatch("push", { data: { text: () => JSON.stringify({ url: "/briefings", test: true }) } });
    expect(sw.showNotification).toHaveBeenCalledWith("Orbit", expect.objectContaining({ body: "Teste das notificações do Orbit.", data: { url: "/briefings", test: true } }));
    const data = sw.showNotification.mock.calls[0][1].data;
    await sw.dispatch("notificationclick", { notification: { data: { ...data, test: false }, close: vi.fn() } });
    expect(sw.openWindow).not.toHaveBeenCalled();
    await sw.dispatch("notificationclick", { notification: { data, close: vi.fn() } });
    expect(sw.openWindow).toHaveBeenCalledWith("https://orbit.example.com/briefings");
    expect(sw.caches.open).not.toHaveBeenCalled();
  });
  it.each([undefined, false, null, 1, "true"])("arquivo só é destino válido com test booleano true, não %j", async test => {
    const sw = worker();
    await sw.dispatch("push", { data: { text: () => JSON.stringify({ url: "/briefings", test }) } });
    await sw.dispatch("notificationclick", { notification: { data: { url: "/briefings", test }, close: vi.fn() } });
    expect(sw.showNotification).not.toHaveBeenCalled(); expect(sw.openWindow).not.toHaveBeenCalled(); expect(sw.matchAll).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example/briefings/1", "https://orbit.example.com/briefings/1", "//evil.example/briefings/1", "/briefings/0", "/briefings/-1", "/briefings/1?redirect=evil", "/briefings/1#secret", "/briefings/9007199254740992", "/briefings/1\n", "/briefings/", "/briefings?next=evil", "/briefings#secret", "/perfil"])("recusa destino inválido %j tanto no push quanto no clique, inclusive em teste", async url => {
    const sw = worker();
    for (const test of [false, true]) {
      await sw.dispatch("push", { data: { text: () => JSON.stringify({ url, test }) } });
      await sw.dispatch("notificationclick", { notification: { data: { url, test }, close: vi.fn() } });
    }
    expect(sw.showNotification).not.toHaveBeenCalled(); expect(sw.openWindow).not.toHaveBeenCalled(); expect(sw.matchAll).not.toHaveBeenCalled();
  });
  it("ignora payload inválido/grande e continua guardando só offline.html", async () => {
    const sw = worker();
    for (const text of ["not-json", "null", "x".repeat(513)]) await sw.dispatch("push", { data: { text: () => text } });
    await sw.dispatch("install", {});
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(sw.cache.add).toHaveBeenCalledOnce();
    expect(new URL(sw.cache.add.mock.calls[0][0].url).pathname).toBe("/offline.html");
  });
});
