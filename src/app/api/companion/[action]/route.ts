import { handleExtensionRequest } from "../../../../lib/extension-http";
import { requestOrigin } from "../../../../lib/hosts";

// API da extensão: token Bearer, Origin chrome-extension:// e jobs presos ao lease. Sem cookies.
export async function POST(request: Request) {
  const origin = requestOrigin(request.headers);
  if (!origin) return Response.json({ error: "Use o endereço HTTPS do Orbit (HTTP só em localhost)." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return handleExtensionRequest(request, origin);
}
