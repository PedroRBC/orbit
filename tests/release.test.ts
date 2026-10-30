import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("mantém versão do pacote, lockfile e imagem padrão alinhadas", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[""].version).toBe(manifest.version);
  expect(readFileSync("compose.yaml", "utf8")).toContain(`ghcr.io/pedrorbc/orbit:${manifest.version}`);
});

it.each([
  [{}, true],
  [{ ref: "refs/tags/v0.2.3" }, true],
  [{ ref: "refs/tags/v0.2.4-rc.1" }, true],
  [{ event_name: "pull_request" }, false],
  [{ event_name: "pull_request_target" }, false],
  [{ event_name: "workflow_dispatch" }, false],
  [{ repository: "contributor/orbit", repository_id: "999" }, false],
  [{ repository: "PedroRBC/another-project" }, false],
  [{ repository_id: "999" }, false],
  [{ actor_id: "999", triggering_actor: "contributor" }, false],
  [{ actor_id: "999" }, false],
  [{ triggering_actor: "contributor" }, false],
  [{ triggering_actor: "github-actions[bot]" }, false],
  [{ ref: "refs/heads/contribution" }, false],
  [{ ref: "refs/tags/test" }, false],
])("restringe a publicação oficial por identidade, evento e ref: %j", (changes, expected) => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const image = workflow.slice(workflow.indexOf("\n  image:"));
  const expression = image.match(/\n    if: (?:>-\n)?([\s\S]*?)\n    runs-on:/)?.[1];
  expect(expression).toBeTruthy();
  const enabled = new Function("github", "startsWith", `return (${expression})`);
  const github = {
    event_name: "push", repository: "PedroRBC/orbit", repository_id: "1436259756",
    actor_id: "58788062", triggering_actor: "PedroRBC", ref: "refs/heads/main", ...changes,
  };
  expect(enabled(github, (value: string, prefix: string) => value.startsWith(prefix))).toBe(expected);
});

it.each([
  ["1436259756", true], ["999", false],
])("confere o repositório oficial antes de publicar: %s", (repositoryId, expected) => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = workflow.slice(workflow.indexOf("- name: Check"), workflow.indexOf("- id: publish"));
  const script = step.split("run: |\n")[1];
  expect(script).toBeTruthy();
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", `
    gh() {
      test "$*" = "api repos/PedroRBC/orbit --jq .id" || return 1
      printf '%s\\n' "$REPOSITORY_ID"
    }
    ${script}
  `], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_REPOSITORY: "PedroRBC/orbit", REPOSITORY_ID: repositoryId } });
  expect(result.error).toBeUndefined();
  expect(result.status === 0).toBe(expected);
});

it.each(["public", "private"])("verifica tags e digest sem bloquear pacote %s", (visibility) => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = workflow.slice(workflow.indexOf("- name: Verify"));
  const script = step.split("run: |\n")[1];
  expect(script).toBeTruthy();
  const dir = mkdtempSync(join(tmpdir(), "orbit-release-"));
  const summary = join(dir, "summary.md");
  try {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", `
      gh() {
        case "$*" in
          "api users/PedroRBC/packages/container/orbit --jq .visibility") printf '%s\\n' "$PACKAGE_VISIBILITY" ;;
          "api users/PedroRBC/packages/container/orbit/versions --paginate")
            printf '%s\\n' '[{"name":"sha256:test","metadata":{"container":{"tags":["0.2.3"]}}}]' ;;
          *) return 1 ;;
        esac
      }
      docker() { printf '%s\\n' '{"digest":"sha256:test"}'; }
      ${script.replaceAll("/tmp/orbit-tags.txt", join(dir, "tags.txt"))}
    `], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, PACKAGE_VISIBILITY: visibility, DIGEST: "sha256:test", IMAGE_TAGS: "ghcr.io/pedrorbc/orbit:0.2.3", GITHUB_STEP_SUMMARY: summary } });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain(`Visibility: ${visibility} (GitHub Packages API).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("publica latest na main e em tags estáveis, nunca em candidatos", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const metadata = workflow.slice(workflow.indexOf("uses: docker/metadata-action@"), workflow.indexOf("- name: Check publication destination"));
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
