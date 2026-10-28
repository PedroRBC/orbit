import { getDatabase } from "../../../db/index";
import { workerOnline } from "../../../lib/store";

export const dynamic = "force-dynamic";
// Usado pelo HEALTHCHECK do contêiner: só booleanos, sem dados pessoais.
export function GET() {
  let worker = false;
  try { worker = workerOnline(getDatabase()); } catch { /* Banco indisponível conta como falha. */ }
  return Response.json({ ok: worker, worker }, { status: worker ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
