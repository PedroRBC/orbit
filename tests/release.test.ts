import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("mantém versão do pacote, lockfile e imagem padrão alinhadas", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[""].version).toBe(manifest.version);
  expect(readFileSync("compose.yaml", "utf8")).toContain(`ghcr.io/pedrorbc/orbit:${manifest.version}`);
});

it("não promove uma tag semver para latest fora da main", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const metadata = workflow.slice(workflow.indexOf("uses: docker/metadata-action@"), workflow.indexOf("- name: Check private publication destination"));
  expect(metadata).toMatch(/flavor:\s*\|?\s*latest=false/);
  expect(metadata).toContain("type=raw,value=latest,enable={{is_default_branch}}");
  expect(metadata).toContain("type=semver,pattern={{version}}");
  expect(metadata).toContain("images: ghcr.io/pedrorbc/orbit");
});
