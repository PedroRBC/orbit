import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "./lib/auth";
import { hostAllowed } from "./lib/hosts";

const publicPaths = ["/login", "/api/health"];
// Checagem otimista (só presença do cookie): páginas, ações e rotas validam a sessão no banco.
export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!hostAllowed(host)) return new NextResponse("Host não permitido. Inclua este endereço em ORBIT_ALLOWED_HOSTS.", { status: 403 });
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/extension/")) return new NextResponse("Use /api/companion.", { status: 403 });
  // A extensão autentica por token e Origin chrome-extension://, validados na própria rota.
  if (path.startsWith("/api/companion/")) return NextResponse.next();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try { if (new URL(origin).host !== host) return new NextResponse("Origem não permitida", { status: 403 }); }
      catch { return new NextResponse("Origem inválida", { status: 403 }); }
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") return new NextResponse("Origem não permitida", { status: 403 });
  }
  if (publicPaths.includes(path) || request.cookies.get(sessionCookie)?.value) return NextResponse.next();
  if (!["GET", "HEAD"].includes(request.method)) return NextResponse.json({ error: "Sessão necessária." }, { status: 401 });
  // Base no Host já validado: request.url pode trazer o endereço interno (0.0.0.0, localhost).
  const scheme = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ? "https" : "http";
  return NextResponse.redirect(new URL(`/login?${new URLSearchParams({ next: path + request.nextUrl.search })}`, `${scheme}://${host}`));
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
