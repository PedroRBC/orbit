import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import manifest from "../../../../../browser-extension/manifest.json";
import { requireSession } from "../../../../lib/session";
import { zipFiles } from "../../../../lib/zip";

// Bundle gerado por `npm run build`/`dev`; só metadados e código público da extensão, sem segredos.
export async function GET() {
  await requireSession();
  const directory = resolve("browser-extension/dist");
  let files: { name: string; data: Buffer }[];
  try { files = readdirSync(directory).map(name => ({ name: `orbit-extensao/${name}`, data: readFileSync(join(directory, name)) })); }
  catch { return new Response("Extensão ainda não compilada. Rode npm run build:extension.", { status: 503 }); }
  return new Response(new Uint8Array(zipFiles(files)), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="orbit-extensao-${manifest.version}.zip"`, "Cache-Control": "no-store" } });
}
