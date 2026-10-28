import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { hostAllowed, requestOrigin } from "../src/lib/hosts";
import { sessionCookie } from "../src/lib/auth";

afterEach(() => { vi.unstubAllEnvs(); });
const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => new NextRequest(`http://127.0.0.1:3000${path}`, { method: init.method || "GET", headers: { Host: "127.0.0.1:3000", ...init.headers } });
const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("hosts e origem", () => {
  it("aceita loopback e somente hosts listados", () => {
    expect(hostAllowed("127.0.0.1:3000", {})).toBe(true);
    expect(hostAllowed("localhost", {})).toBe(true);
    expect(hostAllowed("192.168.0.10:30480", {})).toBe(false);
    expect(hostAllowed("orbit.example.com", { ORBIT_ALLOWED_HOSTS: "orbit.example.com, nas.tail.ts.net:8443" })).toBe(true);
    expect(hostAllowed("nas.tail.ts.net:8443", { ORBIT_ALLOWED_HOSTS: "orbit.example.com, nas.tail.ts.net:8443" })).toBe(true);
    expect(hostAllowed("evil.example.com", { ORBIT_ALLOWED_HOSTS: "orbit.example.com" })).toBe(false);
    expect(hostAllowed("user@orbit.example.com", { ORBIT_ALLOWED_HOSTS: "orbit.example.com" })).toBe(false);
    expect(hostAllowed(null, {})).toBe(false);
  });
  it("só considera seguro HTTPS informado pelo proxy ou HTTP em loopback", () => {
    expect(requestOrigin(new Headers({ host: "orbit.example.com", "x-forwarded-proto": "https" }))).toBe("https://orbit.example.com");
    expect(requestOrigin(new Headers({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
    expect(requestOrigin(new Headers({ host: "192.168.0.10:30480" }))).toBeNull();
    expect(requestOrigin(new Headers({ host: "orbit.example.com", "x-forwarded-proto": "http" }))).toBeNull();
  });
});

describe("proxy", () => {
  it("recusa Host fora da lista antes de qualquer rota", () => {
    expect(proxy(request("/login", { headers: { Host: "attacker.example" } })).status).toBe(403);
    vi.stubEnv("ORBIT_ALLOWED_HOSTS", "orbit.example.com");
    expect(passes(proxy(request("/login", { headers: { Host: "orbit.example.com" } })))).toBe(true);
  });
  it("manda para o login sem sessão e preserva o destino", () => {
    const response = proxy(request("/fontes?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/login?next=%2Ffontes%3Fx%3D1");
    vi.stubEnv("ORBIT_ALLOWED_HOSTS", "orbit.example.com");
    expect(proxy(request("/", { headers: { Host: "orbit.example.com", "X-Forwarded-Proto": "https" } })).headers.get("location")).toBe("https://orbit.example.com/login?next=%2F");
    expect(proxy(request("/status", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" } })).status).toBe(401);
    expect(passes(proxy(request("/fontes", { headers: { Cookie: `${sessionCookie}=qualquer` } })))).toBe(true);
  });
  it("deixa públicos só login, saúde e a API da extensão", () => {
    expect(passes(proxy(request("/login")))).toBe(true);
    expect(passes(proxy(request("/api/health")))).toBe(true);
    expect(passes(proxy(request("/api/companion/poll", { method: "POST", headers: { Origin: `chrome-extension://${"a".repeat(32)}` } })))).toBe(true);
    expect(proxy(request("/api/extension/poll", { method: "POST" })).status).toBe(403);
  });
  it("mantém a checagem de Origin, inclusive no login", () => {
    expect(proxy(request("/login", { method: "POST", headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect(proxy(request("/", { method: "POST", headers: { Origin: "https://attacker.example", Cookie: `${sessionCookie}=x` } })).status).toBe(403);
    expect(proxy(request("/", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", Cookie: `${sessionCookie}=x` } })).status).toBe(403);
  });
});
