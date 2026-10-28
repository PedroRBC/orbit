import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/index";
import { attemptLogin, authConfigured, clearLoginLocks, configureCredentials, createSession, hashPassword, newTotpSecret, revokeAllSessions, revokeSession, sessionValid, totpCode, verifyPassword } from "../src/lib/auth";

const databases: ReturnType<typeof openDatabase>[] = [];
function database() { const db = openDatabase(":memory:"); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
const password = "senha longa de teste";
// RFC 6238, apêndice B: segredo ASCII "12345678901234567890" em base32.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const now = 1_793_000_000_000;
const step = Math.floor(now / 30_000);
function configured() { const db = database(); const recovery = configureCredentials(db, password, rfcSecret); return { db, recovery }; }

describe("senha e TOTP", () => {
  it("usa scrypt com sal e compara sem aceitar senha diferente", () => {
    const stored = hashPassword(password);
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain(password);
    expect(hashPassword(password)).not.toBe(stored);
    expect(verifyPassword(password, stored)).toBe(true);
    expect(verifyPassword("outra senha qualquer", stored)).toBe(false);
  });
  it("segue os vetores SHA-1 da RFC 6238", () => {
    expect(totpCode(rfcSecret, 1)).toBe("287082");
    expect(totpCode(rfcSecret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it("recusa senha curta na configuração", () => {
    expect(() => configureCredentials(database(), "curta", rfcSecret)).toThrow();
  });
});

describe("login", () => {
  it("fica fechado até configurar e então exige senha e código", () => {
    const db = database();
    expect(authConfigured(db)).toBe(false);
    expect(attemptLogin(db, { password, code: "000000", client: "a" }, now)).toHaveProperty("error");
    configureCredentials(db, password, rfcSecret);
    expect(authConfigured(db)).toBe(true);
    expect(attemptLogin(db, { password: "errada errada errada", code: totpCode(rfcSecret, step), client: "a" }, now)).toHaveProperty("error");
    expect(attemptLogin(db, { password, code: "000000", client: "a" }, now)).toHaveProperty("error");
    const result = attemptLogin(db, { password, code: totpCode(rfcSecret, step), client: "a" }, now);
    expect("token" in result && sessionValid(db, result.token, now)).toBe(true);
  });
  it("aceita um passo de tolerância e não reaproveita o mesmo código", () => {
    const { db } = configured();
    const code = totpCode(rfcSecret, step - 1);
    expect(attemptLogin(db, { password, code, client: "a" }, now)).toHaveProperty("token");
    expect(attemptLogin(db, { password, code, client: "a" }, now)).toHaveProperty("error");
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step - 2), client: "a" }, now)).toHaveProperty("error");
  });
  it("aceita código de recuperação uma única vez, com ou sem hífen", () => {
    const { db, recovery } = configured();
    expect(recovery).toHaveLength(8);
    expect(recovery[0]).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(attemptLogin(db, { password, code: recovery[0].replaceAll("-", "").toLowerCase(), client: "a" }, now)).toHaveProperty("token");
    expect(attemptLogin(db, { password, code: recovery[0], client: "a" }, now)).toHaveProperty("error");
  });
  it("bloqueia só o cliente que errou 5 vezes, sem trancar o dono por tentativas de outros", { timeout: 15_000 }, () => {
    const { db } = configured();
    for (let index = 0; index < 5; index++) attemptLogin(db, { password, code: "000000", client: "a" }, now);
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step), client: "a" }, now)).toMatchObject({ error: expect.stringContaining("Muitas tentativas") });
    // Acima do antigo teto global de 20 falhas.
    for (let index = 0; index < 25; index++) attemptLogin(db, { password, code: "000000", client: `c${index}` }, now);
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step), client: "b" }, now)).toHaveProperty("token");
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step + 30), client: "a" }, now + 15 * 60_000)).toHaveProperty("token");
  });
  it("desbloqueio manual limpa os bloqueios sem trocar credenciais", () => {
    const { db } = configured();
    for (let index = 0; index < 5; index++) attemptLogin(db, { password, code: "000000", client: "a" }, now);
    clearLoginLocks(db);
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step), client: "a" }, now)).toHaveProperty("token");
  });
  it("o código usado para confirmar o setup não serve para entrar", () => {
    const db = database();
    configureCredentials(db, password, rfcSecret, step);
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step), client: "a" }, now)).toHaveProperty("error");
    expect(attemptLogin(db, { password, code: totpCode(rfcSecret, step + 1), client: "a" }, now)).toHaveProperty("token");
  });
});

describe("sessões", () => {
  it("guarda só o hash, expira em 30 dias e pode ser revogada", () => {
    const db = database();
    const token = createSession(db, now);
    expect(JSON.stringify(db.$client.prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(sessionValid(db, token, now + 29 * 86_400_000)).toBe(true);
    expect(sessionValid(db, token, now + 30 * 86_400_000)).toBe(false);
    expect(sessionValid(db, undefined, now)).toBe(false);
    expect(sessionValid(db, "inventado", now)).toBe(false);
    const other = createSession(db, now);
    revokeSession(db, token);
    expect(sessionValid(db, token, now)).toBe(false);
    expect(sessionValid(db, other, now)).toBe(true);
    revokeAllSessions(db);
    expect(sessionValid(db, other, now)).toBe(false);
  });
  it("reconfigurar o acesso derruba as sessões abertas", () => {
    const { db } = configured();
    const token = createSession(db, now);
    configureCredentials(db, password, newTotpSecret());
    expect(sessionValid(db, token, now)).toBe(false);
  });
});
