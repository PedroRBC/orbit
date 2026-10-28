import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { POST as companion } from "../src/app/api/companion/[action]/route";
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
  it("pareia por HTTPS em qualquer host e por HTTP só em loopback", () => {
    const { db } = setup();
    expect(() => pairExtension(db, createPairingCode(db), extensionId, "http://192.168.0.10:30480")).toThrow(/HTTPS/);
    expect(() => pairExtension(db, createPairingCode(db), extensionId, "http://orbit.example.com")).toThrow(/HTTPS/);
    expect(pairExtension(db, createPairingCode(db), extensionId, "https://orbit.example.com").serverOrigin).toBe("https://orbit.example.com");
  });
  it("a rota da extensão recusa HTTP fora de loopback e Origin de página comum", async () => {
    const post = (headers: Record<string, string>) => companion(new Request("http://0.0.0.0:3000/api/companion/pair", { method: "POST", headers: { "Content-Type": "application/json", "X-Orbit-Extension-Id": extensionId, ...headers }, body: JSON.stringify({ code: "x" }) }));
    const insecure = await post({ Host: "orbit.example.com", Origin: origin });
    expect(insecure.status).toBe(403);
    expect((await insecure.json()).error).toMatch(/HTTPS/);
    const page = await post({ Host: "orbit.example.com", "X-Forwarded-Proto": "https", Origin: "https://evil.example" });
    expect(page.status).toBe(403);
    expect((await page.json()).error).toMatch(/Origem/);
  });
  it("a API da extensão exige Content-Length de até 3 MB antes de ler o corpo", async () => {
    const post = (headers: Record<string, string>) => companion(new Request("http://0.0.0.0:3000/api/companion/pair", { method: "POST", headers: { Host: "127.0.0.1:3000", "Content-Type": "application/json", Origin: origin, "X-Orbit-Extension-Id": extensionId, ...headers }, body: JSON.stringify({ code: "x" }) }));
    expect((await post({})).status).toBe(411);
    expect((await post({ "Content-Length": "3000001" })).status).toBe(413);
    expect((await post({ "Content-Length": "abc" })).status).toBe(411);
    expect((await post({ "Content-Length": String(JSON.stringify({ code: "x" }).length) })).status).toBe(401);
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
