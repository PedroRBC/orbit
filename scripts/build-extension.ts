import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildExtension() {
  const directory = resolve("browser-extension/dist");
  await mkdir(directory, { recursive: true });
  const common = { bundle: true, platform: "browser" as const, format: "iife" as const, target: "chrome120", minify: true, legalComments: "none" as const };
  await Promise.all([
    build({ ...common, entryPoints: ["browser-extension/src/background.ts"], outfile: `${directory}/background.js` }),
    build({ ...common, entryPoints: ["browser-extension/src/popup.ts"], outfile: `${directory}/popup.js` }),
    build({ ...common, entryPoints: ["browser-extension/src/reader.ts"], outfile: `${directory}/reader.js`, globalName: "OrbitFeedReader" }),
    ...["manifest.json", "popup.html", "popup.css"].map(file => copyFile(`browser-extension/${file}`, `${directory}/${file}`)),
  ]);
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Extensão Orbit pronta em ${await buildExtension()}`);
}
