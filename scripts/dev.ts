import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { bridgePort } from "../src/lib/extension-http";
import { buildExtension } from "./build-extension";
import { getDatabase } from "../src/db/index";

process.umask(0o077);
const production = process.argv.includes("--production");
const host = process.env.ORBIT_HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ORBIT_HOST ou PORT inválido.");
for (const [targetPort, targetHost] of [[port, host], [bridgePort(), "127.0.0.1"]] as const) {
  const probe = createServer();
  await new Promise<void>((done, reject) => { probe.once("error", reject); probe.listen(targetPort, targetHost, () => probe.close(() => done())); });
}
if (bridgePort() === port) throw new Error("PORT e ORBIT_EXTENSION_PORT precisam ser diferentes.");
await buildExtension();
getDatabase();
const children: ChildProcess[] = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.pid) continue;
    try { child.kill("SIGTERM"); } catch { /* O processo pode já ter encerrado. */ }
  }
  getDatabase().$client.close();
  const force = setTimeout(() => {
    for (const child of children) if (child.pid && child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* Já encerrado. */ } }
    process.exit(code);
  }, 5000);
  force.unref();
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(done => child.once("exit", () => done())))).then(() => process.exit(code));
}
function launch(args: string[]) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", code => { if (!closing) stop(code ?? 1); });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
launch(["--import", "tsx", resolve("src/extension-server.ts")]);
launch([resolve("node_modules/next/dist/bin/next"), production ? "start" : "dev", "--hostname", host, "--port", String(port)]);
launch(["--import", "tsx", resolve("src/worker.ts")]);
console.log(`Orbit: http://${host}:${port}`);
if (host === "0.0.0.0") console.warn("Acesso LAN ativado explicitamente. O Orbit não possui login: use somente em rede confiável.");
