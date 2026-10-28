import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
import { isPublicAddress, publicFeedURL, fetchPublicXML } from "../src/lib/public-feed";
import { parseNewsFeed } from "../src/collectors/news";

const xml = '<rss version="2.0"><channel><title>Portal de teste</title><item><title>Notícia sintética</title><link>https://news.example.com/article?utm_source=test</link><description>Resumo do editor, não artigo completo.</description><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
function respond(status = 200, body = xml, location?: string) {
  network.request.mockImplementation((_options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error?: Error) => void };
    req.end = () => queueMicrotask(() => {
      const response = new Readable({ read() {} }) as Readable & { statusCode: number; headers: Record<string, string> };
      response.statusCode = status; response.headers = { "content-type": "application/rss+xml", ...(location ? { location } : {}) };
      callback(response); response.push(body); response.push(null);
    });
    req.destroy = error => { if (error) req.emit("error", error); };
    return req;
  });
}
beforeEach(() => { vi.clearAllMocks(); network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); respond(); });

describe("RSS público sem SSRF", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2001:db8::1"])("recusa endereço não público %s", address => { expect(isPublicAddress(address)).toBe(false); });
  it("aceita endereços globais e exige hostname HTTPS normal", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(publicFeedURL("https://news.example.com/rss#ignore").href).toBe("https://news.example.com/rss");
    expect(publicFeedURL("https://news.example.com./rss").hostname).toBe("news.example.com");
    for (const url of ["http://news.example.com/rss", "https://127.0.0.1/rss", "https://localhost/rss", "https://server.local/rss", "https://user:pass@news.example.com/rss", "https://news.example.com:8443/rss"]) expect(() => publicFeedURL(url)).toThrow();
  });
  it("fixa a conexão no IP público validado e mantém SNI/Host do portal", async () => {
    expect(await fetchPublicXML("https://news.example.com/rss")).toBe(xml);
    const options = network.request.mock.calls[0][0];
    expect(options).toMatchObject({ hostname: "8.8.8.8", servername: "news.example.com", method: "GET", port: 443, headers: { Host: "news.example.com" } });
  });
  it("bloqueia DNS privado/misto antes do socket", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "192.168.0.1", family: 4 }]);
    await expect(fetchPublicXML("https://news.example.com/rss")).rejects.toThrow();
    expect(network.request).not.toHaveBeenCalled();
  });
  it("não segue redirecionamento para a rede local", async () => {
    respond(302, "", "https://127.0.0.1/private");
    await expect(fetchPublicXML("https://news.example.com/rss")).rejects.toThrow();
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("não transforma updated do Atom em data de publicação", async () => {
    const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture Atom</title><id>urn:fixture</id><updated>2026-10-28T10:00:00Z</updated><entry><id>urn:updated-only</id><title>Item sem publicação</title><link href="https://news.example.com/updated-only"/><updated>2026-10-28T10:00:00Z</updated></entry><entry><id>urn:old</id><title>Item antigo atualizado</title><link href="https://news.example.com/old"/><published>2026-10-01T10:00:00Z</published><updated>2026-10-28T10:00:00Z</updated></entry></feed>';
    const items = await parseNewsFeed(atom, "Fixture");
    expect(items[0]).toMatchObject({ publishedAt: null, newsPublishedAt: null });
    expect(items[1]).toMatchObject({ publishedAt: Date.parse("2026-10-01T10:00:00Z"), newsPublishedAt: Date.parse("2026-10-01T10:00:00Z") });
  });
  it("normaliza trechos/URLs e não baixa imagens ou artigos", async () => {
    const items = await parseNewsFeed(xml, "Portal de teste");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ platform: "news", evidence: "news_rss", title: "Notícia sintética", text: "Resumo do editor, não artigo completo.", thumbnail: null, url: "https://news.example.com/article" });
    expect(items[0].newsPublishedAt).toBe(Date.parse("2026-10-28T10:00:00Z"));
    expect(network.request).not.toHaveBeenCalled();
    await expect(parseNewsFeed('<!DOCTYPE rss [<!ENTITY x "y">]><rss/>', "Portal")).rejects.toThrow();
  });
});
