import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipFiles } from "../src/lib/zip";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("gera ZIP válido que leitores padrão extraem sem erro", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-zip-"));
  directories.push(directory);
  const file = join(directory, "extensao.zip");
  writeFileSync(file, zipFiles([{ name: "orbit-extensao/manifest.json", data: Buffer.from('{"name":"Orbit — coletor"}') }, { name: "orbit-extensao/vazio.txt", data: Buffer.alloc(0) }]));
  const check = "import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(z.namelist())\nprint(z.read('orbit-extensao/manifest.json').decode())";
  const output = execFileSync("python3", ["-I", "-c", check, file], { encoding: "utf8" });
  expect(output).toContain("['orbit-extensao/manifest.json', 'orbit-extensao/vazio.txt']");
  expect(output).toContain('{"name":"Orbit — coletor"}');
});
