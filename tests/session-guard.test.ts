import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Server Actions são endpoints públicos: a checagem de página não as protege.
it("toda Server Action protegida valida a sessão antes de agir", () => {
  const files = ["actions.ts", ...readdirSync("src/app").filter(file => file.endsWith("-actions.ts"))];
  const actions = files.flatMap(file => [...readFileSync(join("src/app", file), "utf8").matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)]);
  expect(actions.length).toBeGreaterThan(10);
  for (const [, name, firstLine] of actions) expect(`${name}: ${firstLine.trim()}`).toBe(`${name}: await requireSession();`);
});

// Layout não protege a renderização da página (payload RSC): cada página e rota checa por conta própria.
it("toda página e rota do grupo protegido valida a sessão primeiro", () => {
  const files = readdirSync("src/app/(app)", { recursive: true, encoding: "utf8" }).filter(file => /(^|\/)(page|route)\.tsx?$/.test(file));
  expect(files.length).toBeGreaterThan(6);
  for (const file of files) {
    const source = readFileSync(join("src/app/(app)", file), "utf8");
    const body = source.match(/export (?:default )?async function \w+\([^)]*\)[^{]*\{\n(.*)\n/);
    expect(`${file}: ${body?.[1].trim()}`).toBe(`${file}: await requireSession();`);
  }
});
