import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { browserCommand } from "../src/lib/default-browser";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { collectorRuns, companionJobs, sources } from "../src/db/schema";
import { acquireLease, claimRun, enqueueCollection } from "../src/lib/store";
import { createPairingCode, pairExtension, verifyExtension, revokeExtension, createCaptureJob, claimCaptureJob, completeCaptureJob, captureResult, rejectCaptureJob, extensionOriginAllowed } from "../src/lib/extension";

const databases: ReturnType<typeof openDatabase>[] = [];
const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;
afterEach(() => { vi.useRealTimers(); for (const db of databases.splice(0)) db.$client.close(); });
function setup() {
  const db = openDatabase(":memory:"); databases.push(db);
  const source = db.insert(sources).values({ channelId: "https://www.youtube.com/", name: "Home", kind: "youtube_home" }).returning().get();
  acquireLease(db, "owner");
  const parent = enqueueCollection(db); claimRun(db);
  const run = db.insert(collectorRuns).values({ sourceId: source.id, parentId: parent, status: "running", startedAt: Date.now() }).returning().get();
  return { db, source, run };
}
const item = { platform: "youtube", externalId: "abcdefghijk", title: "Aula", text: "", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", publishedAt: null, durationSeconds: null, evidence: "youtube_home" };

describe("pareamento da extensão", () => {
  it("abre o navegador habitual sem flags ou perfil de automação", () => {
    expect(browserCommand("youtube", "linux")).toEqual({ command: "gio", args: ["open", "https://www.youtube.com/"] });
    expect(browserCommand("x", "darwin")).toEqual({ command: "open", args: ["https://x.com/home"] });
    expect(() => browserCommand("invalid" as "youtube")).toThrow();
  });
  it("usa código único e revoga o token sem expor cookie", () => {
    const { db } = setup(); const code = createPairingCode(db);
    const result = pairExtension(db, code, extensionId, "http://127.0.0.1:3000");
    expect(result.token.length).toBeGreaterThanOrEqual(32);
    expect(verifyExtension(db, result.token, extensionId).extensionId).toBe(extensionId);
    expect(() => pairExtension(db, code, extensionId, "http://127.0.0.1:3000")).toThrow();
    revokeExtension(db);
    expect(() => verifyExtension(db, result.token, extensionId)).toThrow();
  });
  it("expira o código e limita tentativas inválidas", () => {
    const { db } = setup();
    const code = createPairingCode(db);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(() => pairExtension(db, code, extensionId, "http://127.0.0.1:3000")).toThrow();
    vi.useRealTimers();
    const freshCode = createPairingCode(db);
    for (let index = 0; index < 10; index++) expect(() => pairExtension(db, "wrong", extensionId, "http://127.0.0.1:3000")).toThrow();
    expect(() => pairExtension(db, freshCode, extensionId, "http://127.0.0.1:3000")).toThrow();
  });
  it("não expõe a ponte pela porta da interface, mesmo com Host forjado", () => {
    const request = new NextRequest("http://192.168.0.2:3000/api/extension/poll", { method: "POST", headers: { Host: "127.0.0.1:3000", Origin: origin, "X-Orbit-Extension-Id": extensionId } });
    expect(proxy(request).status).toBe(403);
  });
  it("recusa origem de página comum e extensão com ID diferente", () => {
    expect(extensionOriginAllowed(origin, extensionId)).toBe(true);
    expect(extensionOriginAllowed("https://evil.example", extensionId)).toBe(false);
    expect(extensionOriginAllowed(`chrome-extension://${"b".repeat(32)}`, extensionId)).toBe(false);
    expect(extensionOriginAllowed(null, extensionId)).toBe(true);
    expect(extensionOriginAllowed(origin, "invalid")).toBe(false);
  });
});

describe("fila autenticada da extensão", () => {
  it("entrega um pedido uma única vez e recebe somente metadados válidos", () => {
    const { db, source, run } = setup();
    const job = createCaptureJob(db, source.id, run.id);
    expect(claimCaptureJob(db)?.id).toBe(job.id);
    expect(claimCaptureJob(db)).toBeNull();
    completeCaptureJob(db, job.id, { items: [item] });
    expect(captureResult(db, job.id)).toMatchObject([{ platform: "youtube", externalId: "abcdefghijk", evidence: "youtube_home" }]);
    expect(() => completeCaptureJob(db, job.id, { items: [item] })).toThrow();
  });
  it("recusa cookies, plataforma divergente e links arbitrários", () => {
    const { db, source, run } = setup(); const job = createCaptureJob(db, source.id, run.id); claimCaptureJob(db);
    expect(() => completeCaptureJob(db, job.id, { items: [{ ...item, cookie: "not-allowed" }] })).toThrow();
    expect(() => completeCaptureJob(db, job.id, { items: [{ ...item, platform: "x" }] })).toThrow();
    expect(() => completeCaptureJob(db, job.id, { items: [{ ...item, url: "http://127.0.0.1/private" }] })).toThrow();
    expect(db.select().from(companionJobs).where(eq(companionJobs.id, job.id)).get()?.status).toBe("claimed");
  });
  it("falha imediatamente quando um resultado inválido é rejeitado", () => {
    const { db, source, run } = setup(); const job = createCaptureJob(db, source.id, run.id); claimCaptureJob(db);
    expect(() => completeCaptureJob(db, job.id, { items: [{ ...item, url: "not-a-url" }] })).toThrow();
    rejectCaptureJob(db, job.id);
    expect(() => captureResult(db, job.id)).toThrow(/não reconheceu o feed/);
  });
  it("descarta thumbnail inválida sem perder o item válido", () => {
    const { db, source, run } = setup(); const job = createCaptureJob(db, source.id, run.id); claimCaptureJob(db);
    completeCaptureJob(db, job.id, { items: [{ ...item, thumbnail: "/relative.jpg" }] });
    expect(captureResult(db, job.id)?.[0].thumbnail).toBeNull();
  });
  it("não aceita resultado vencido ou de um worker que perdeu o lease", () => {
    const { db, source, run } = setup(); const job = createCaptureJob(db, source.id, run.id); claimCaptureJob(db);
    db.update(companionJobs).set({ expiresAt: Date.now() - 1 }).where(eq(companionJobs.id, job.id)).run();
    expect(() => completeCaptureJob(db, job.id, { items: [item] })).toThrow();
    db.update(companionJobs).set({ expiresAt: Date.now() + 60000 }).where(eq(companionJobs.id, job.id)).run();
    vi.setSystemTime(Date.now() + 61000); acquireLease(db, "new-owner");
    expect(() => completeCaptureJob(db, job.id, { items: [item] })).toThrow();
  });
});
