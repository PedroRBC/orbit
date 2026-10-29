import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("mantém versão do pacote, lockfile e imagem padrão alinhadas", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[""].version).toBe(manifest.version);
  expect(readFileSync("compose.yaml", "utf8")).toContain(`ghcr.io/pedrorbc/orbit:${manifest.version}`);
});

it("publica latest na main e em tags estáveis, nunca em candidatos", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const metadata = workflow.slice(workflow.indexOf("uses: docker/metadata-action@"), workflow.indexOf("- name: Check private publication destination"));
  expect(metadata).toMatch(/flavor:\s*\|?\s*latest=false/);
  const expression = metadata.match(/type=raw,value=latest,enable=\$\{\{\s*(.*?)\s*\}\}/)?.[1];
  expect(expression).toBeTruthy();
  const enabled = new Function("github", "startsWith", "contains", `return (${expression})`);
  for (const [ref, expected] of [
    ["refs/heads/main", true], ["refs/tags/v0.2.2", true],
    ["refs/tags/v0.2.2-rc.1", false], ["refs/heads/fix-http", false],
  ] as const) {
    expect(enabled({ ref, ref_name: ref.split("/").at(-1) }, (value: string, prefix: string) => value.startsWith(prefix), (value: string, part: string) => value.includes(part))).toBe(expected);
  }
  expect(metadata).toContain("type=semver,pattern={{version}}");
  expect(metadata).toContain("images: ghcr.io/pedrorbc/orbit");
});
