import "dotenv/config";
import { createServer } from "node:http";
import { bridgePort, handleExtensionRequest } from "./lib/extension-http";

process.umask(0o077);
const port = bridgePort();
const server = createServer(async (incoming, outgoing) => {
  if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress || "")) { outgoing.writeHead(403).end(); return; }
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 3_000_000) { outgoing.writeHead(413, { Connection: "close" }).end(); return; }
      chunks.push(chunk);
    }
    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) requestHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
    const request = new Request(`http://127.0.0.1:${port}${incoming.url || "/"}`, { method: incoming.method || "GET", headers: requestHeaders, ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}) });
    const response = await handleExtensionRequest(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Pedido inválido." })); }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, "127.0.0.1", () => console.log(`Ponte Orbit local: http://127.0.0.1:${port}`));
const stop = () => { server.closeAllConnections(); server.close(() => process.exit()); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
