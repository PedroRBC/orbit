import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { CollectorError, retryAfterMs } from "../collectors/errors";

const denied = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) denied.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) denied.addSubnet(address, prefix, "ipv6");
const globalIPv6 = new BlockList(); globalIPv6.addSubnet("2000::", 3, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, "ipv4") : family === 6 ? globalIPv6.check(address, "ipv6") && !denied.check(address, "ipv6") : false;
}
export function publicFeedURL(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw new CollectorError("unsafe_source", "Use um feed público HTTPS, sem credenciais, porta especial ou endereço de rede local.");
  url.hostname = host;
  url.hash = "";
  return url;
}
async function resolvePublic(host: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    const addresses = await Promise.race([lookup(host, { all: true, verbatim: true }), new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("Tempo de DNS excedido.")); signal.addEventListener("abort", abort, { once: true }); })]);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new CollectorError("unsafe_source", "O endereço do RSS resolve para uma rede não pública. A coleta foi bloqueada.");
    return addresses[0];
  } finally { signal.removeEventListener("abort", abort); }
}
type Response = { status: number; location?: string; retryAfter?: string; text: string };
export async function fetchPublicXML(input: string, externalSignal?: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(externalSignal ? [externalSignal] : [])]);
  let url = publicFeedURL(input);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const address = await resolvePublic(url.hostname, signal);
    const response = await new Promise<Response>((resolve, reject) => {
      const req = request({ hostname: address.address, family: address.family, servername: url.hostname, checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate), port: 443, method: "GET", path: url.pathname + url.search, headers: { Host: url.host, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "Accept-Encoding": "identity", "User-Agent": "Orbit/0.2 personal RSS reader" }, rejectUnauthorized: true, agent: false, signal }, incoming => {
        incoming.once("error", reject);
        const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
        const status = incoming.statusCode || 0;
        const result = { status, location: first(incoming.headers.location), retryAfter: first(incoming.headers["retry-after"]), text: "" };
        if (status !== 200) { incoming.destroy(); resolve(result); return; }
        const contentType = first(incoming.headers["content-type"]) || "";
        const encoding = first(incoming.headers["content-encoding"]) || "identity";
        if ((contentType && !/^(application\/(rss\+xml|atom\+xml|xml|rdf\+xml)|text\/(xml|plain))/i.test(contentType)) || encoding !== "identity") { incoming.destroy(); reject(new Error("O endereço não entregou XML RSS/Atom sem compactação.")); return; }
        const chunks: Uint8Array[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) { incoming.destroy(); req.destroy(); reject(new Error("RSS excede o limite de 2 MB.")); return; }
          chunks.push(chunk);
        });
        incoming.once("end", () => resolve({ ...result, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.once("error", reject); req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location && redirect < 3) { url = publicFeedURL(new URL(response.location, url).href); continue; }
    if (response.status === 429) throw new CollectorError("rate_limited", "O portal pediu redução de frequência. A fonte respeitará Retry-After.", retryAfterMs(response.retryAfter || null));
    if (response.status !== 200) throw new Error("O feed público não respondeu com conteúdo válido.");
    return response.text;
  }
  throw new Error("Redirecionamentos demais no feed.");
}
