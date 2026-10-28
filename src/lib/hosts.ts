const loopback = ["localhost", "127.0.0.1", "[::1]"];
function parse(host: string | null) {
  if (!host) return null;
  try { const url = new URL(`http://${host}`); return url.username || url.password || url.pathname !== "/" ? null : url; } catch { return null; }
}
export function isLoopbackHost(host: string | null) { const url = parse(host); return !!url && loopback.includes(url.hostname); }
// Host local sempre; os demais só se listados em ORBIT_ALLOWED_HOSTS (nome, ou nome:porta).
export function hostAllowed(host: string | null, env: Record<string, string | undefined> = process.env) {
  const url = parse(host);
  if (!url) return false;
  if (loopback.includes(url.hostname)) return true;
  const allowed = (env.ORBIT_ALLOWED_HOSTS || "").split(/[\s,]+/).map(entry => entry.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(url.hostname) || allowed.includes(url.host);
}
// Último salto do X-Forwarded-For: o que o proxy reverso acrescentou (os anteriores vêm do cliente).
export function loginClient(headers: Headers) { return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local"; }
// Origem pública vista pelo navegador: HTTPS informado pelo proxy reverso, ou HTTP só em loopback.
export function requestOrigin(headers: Headers) {
  const url = parse(headers.get("host"));
  if (!url) return null;
  if (headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https") return `https://${url.host}`;
  return loopback.includes(url.hostname) ? `http://${url.host}` : null;
}
