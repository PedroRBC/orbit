import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { return new NextResponse("Host inválido", { status: 403 }); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const lan = process.env.ORBIT_HOST === "0.0.0.0" && /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hostname);
  if (!local && !lan) return new NextResponse("Acesso permitido somente no host local configurado.", { status: 403 });
  if (request.nextUrl.pathname.startsWith("/api/extension/")) return new NextResponse("Use a ponte loopback dedicada.", { status: 403 });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try { if (new URL(origin).host !== host) return new NextResponse("Origem não permitida", { status: 403 }); }
      catch { return new NextResponse("Origem inválida", { status: 403 }); }
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") return new NextResponse("Origem não permitida", { status: 403 });
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
