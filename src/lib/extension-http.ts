import { z } from "zod";
import { getDatabase } from "../db/index";
import { ExtensionError, extensionOriginAllowed, pairExtension, verifyExtension, revokeExtension, claimCaptureJob, completeCaptureJob, rejectCaptureJob } from "./extension";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function bridgePort(env: Record<string, string | undefined> = process.env) {
  return z.coerce.number().int().min(1024).max(65535).parse(env.ORBIT_EXTENSION_PORT || Number(env.PORT || "3000") + 1);
}
export function bridgeURL() { return `http://127.0.0.1:${bridgePort()}`; }
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ExtensionError("Use application/json.", 415);
  if (Number(request.headers.get("content-length")) > 3_000_000) throw new ExtensionError("Pedido grande demais.", 413);
  return request.json();
}
export async function handleExtensionRequest(request: Request) {
  try {
    if (request.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405, headers });
    const extensionId = request.headers.get("x-orbit-extension-id") || "";
    if (!extensionOriginAllowed(request.headers.get("origin"), extensionId)) throw new ExtensionError("Origem não autorizada.", 403);
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/extension\/(pair|poll|result|disconnect)$/);
    if (!match || url.search) throw new ExtensionError("Operação não disponível.", 404);
    const action = match[1], db = getDatabase();
    if (action === "pair") {
      const input = z.object({ code: z.string().min(1).max(200) }).strict().parse(await body(request));
      return Response.json(pairExtension(db, input.code, extensionId, url.origin), { headers });
    }
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) throw new ExtensionError("Token necessário.", 401);
    const token = authorization.slice(7);
    const version = request.headers.get("x-orbit-extension-version");
    verifyExtension(db, token, extensionId, version);
    const input = await body(request);
    if (action === "poll") {
      z.object({}).strict().parse(input);
      const job = db.transaction(() => { verifyExtension(db, token, extensionId, version); return claimCaptureJob(db); }, { behavior: "immediate" });
      return Response.json({ job }, { headers });
    }
    if (action === "result") {
      const parsed = z.object({ id: z.string().uuid(), result: z.unknown() }).strict().parse(input);
      try { db.transaction(() => { verifyExtension(db, token, extensionId, version); completeCaptureJob(db, parsed.id, parsed.result); }, { behavior: "immediate" }); }
      catch (error) { db.transaction(() => { verifyExtension(db, token, extensionId, version); rejectCaptureJob(db, parsed.id); }, { behavior: "immediate" }); throw error; }
      return Response.json({ ok: true }, { headers });
    }
    z.object({}).strict().parse(input);
    db.transaction(() => { verifyExtension(db, token, extensionId, version); revokeExtension(db); }, { behavior: "immediate" });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ExtensionError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Pedido inválido. Nenhuma credencial de plataforma é aceita." }, { status: 400, headers });
  }
}
