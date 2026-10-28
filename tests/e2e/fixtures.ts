import { test as base, expect } from "@playwright/test";
import { resolve } from "node:path";
import { openDatabase } from "../../src/db/index";
import { authConfigured, configureCredentials, createSession, sessionCookie } from "../../src/lib/auth";

// Credenciais sintéticas, válidas só no banco isolado em test-results.
export const password = "senha somente para e2e";
export const totpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const test = base.extend<{ session: string }>({
  session: [async ({ context, baseURL }, use) => {
    const db = openDatabase(resolve("test-results/e2e.db"));
    let token: string;
    try { if (!authConfigured(db)) configureCredentials(db, password, totpSecret); token = createSession(db); } finally { db.$client.close(); }
    // CDP recusa cookie __Host- definido por URL http; domain/path equivale a um cookie host-only.
    await context.addCookies([{ name: sessionCookie, value: token, domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Strict" }]);
    await use(token);
  }, { auto: true }],
});
export { expect };
