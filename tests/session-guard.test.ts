import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Server Actions são endpoints públicos: a checagem de página não as protege.
it("toda Server Action protegida valida a sessão antes de agir", () => {
  const source = readFileSync("src/app/actions.ts", "utf8");
  const actions = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
  expect(actions.length).toBeGreaterThan(10);
  for (const [, name, firstLine] of actions) expect(`${name}: ${firstLine.trim()}`).toBe(`${name}: await requireSession();`);
});
