import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, lte } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { sessions } from "../db/schema";
import { getSetting, setSetting } from "./store";

export const sessionCookie = "__Host-orbit_session";
export const sessionMaxAge = 30 * 86_400;
const credentialsKey = "auth_credentials", throttleKey = "auth_throttle";
const windowMs = 15 * 60_000, clientLimit = 5;
type Credentials = { password: string; totp: string; recovery: string[]; lastStep: number };
type Throttle = Record<string, { failures: number; since: number; lockedUntil: number }>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g)!.map(chunk => alphabet[parseInt(chunk.padEnd(5, "0"), 2)]).join("");
}
function fromBase32(value: string) {
  const bits = [...value.toUpperCase()].map(char => { const index = alphabet.indexOf(char); if (index < 0) throw new Error("Segredo TOTP inválido."); return index.toString(2).padStart(5, "0"); }).join("");
  return Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
}

// scrypt N=2^15, r=8: ~32 MiB por verificação, caro para força bruta offline.
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$32768$8$1$${salt.toString("base64")}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [kind, N, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 }), expected);
}
export function newTotpSecret() { return base32(randomBytes(20)); }
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export function totpURI(secret: string) { return `otpauth://totp/Orbit?secret=${secret}&issuer=Orbit&algorithm=SHA1&digits=6&period=30`; }

function credentials(db: OrbitDB): Credentials | null { const value = getSetting(db, credentialsKey); return value ? JSON.parse(value) : null; }
export function authConfigured(db: OrbitDB) { return credentials(db) !== null; }
// lastStep: passo TOTP já usado para confirmar o setup, que não pode servir para entrar.
export function configureCredentials(db: OrbitDB, password: string, secret: string, lastStep = 0): string[] {
  if (password.length < 12 || password.length > 1024) throw new Error("Use uma senha entre 12 e 1024 caracteres.");
  fromBase32(secret);
  const recovery = Array.from({ length: 8 }, () => base32(randomBytes(10)).match(/.{4}/g)!.join("-"));
  const stored: Credentials = { password: hashPassword(password), totp: secret, recovery: recovery.map(code => sha256(code.replaceAll("-", ""))), lastStep };
  db.transaction(() => { setSetting(db, credentialsKey, JSON.stringify(stored)); setSetting(db, throttleKey, "{}"); db.delete(sessions).run(); }, { behavior: "immediate" });
  return recovery;
}

export function createSession(db: OrbitDB, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
  db.insert(sessions).values({ id: sha256(token), createdAt: now, expiresAt: now + sessionMaxAge * 1000 }).run();
  return token;
}
export function sessionValid(db: OrbitDB, token: string | undefined, now = Date.now()) {
  if (!token || token.length > 200) return false;
  const session = db.select().from(sessions).where(eq(sessions.id, sha256(token))).get();
  return !!session && session.expiresAt > now;
}
export function revokeSession(db: OrbitDB, token: string | undefined) { if (token) db.delete(sessions).where(eq(sessions.id, sha256(token))).run(); }
export function revokeAllSessions(db: OrbitDB) { db.delete(sessions).run(); }
export function clearLoginLocks(db: OrbitDB) { setSetting(db, throttleKey, "{}"); }

// Limite só por cliente: um bloqueio global deixaria qualquer um trancar o dono fora. Senha forte + TOTP
// tornam a adivinhação online inviável; o volume deve ser contido também no proxy reverso.
export function attemptLogin(db: OrbitDB, input: { password: string; code: string; client: string }, now = Date.now()): { token: string } | { error: string } {
  return db.transaction(() => {
    const stored = credentials(db);
    if (!stored) return { error: "Acesso ainda não configurado. Rode `npm run auth -- setup` no servidor." };
    const throttle: Throttle = JSON.parse(getSetting(db, throttleKey) || "{}");
    for (const [key, entry] of Object.entries(throttle)) if (entry.lockedUntil <= now && entry.since <= now - windowMs) delete throttle[key];
    const key = `client:${input.client.slice(0, 100)}`;
    const lockedUntil = throttle[key]?.lockedUntil ?? 0;
    if (lockedUntil > now) return { error: `Muitas tentativas. Tente novamente em ${Math.ceil((lockedUntil - now) / 60_000)} min.` };
    const code = input.code.replace(/[\s-]/g, "").toUpperCase();
    const passwordOK = input.password.length <= 1024 && verifyPassword(input.password, stored.password);
    const current = Math.floor(now / 30_000);
    const step = /^\d{6}$/.test(code) ? [current - 1, current, current + 1].find(candidate => candidate > stored.lastStep && sameText(totpCode(stored.totp, candidate), code)) : undefined;
    const recovery = step === undefined ? stored.recovery.findIndex(hash => sameText(hash, sha256(code))) : -1;
    if (!passwordOK || (step === undefined && recovery < 0)) {
      const entry = throttle[key] && throttle[key].since > now - windowMs ? throttle[key] : { failures: 0, since: now, lockedUntil: 0 };
      entry.failures++;
      if (entry.failures >= clientLimit) Object.assign(entry, { failures: 0, since: now, lockedUntil: now + windowMs });
      throttle[key] = entry;
      setSetting(db, throttleKey, JSON.stringify(throttle));
      return { error: "Senha ou código inválido." };
    }
    if (step !== undefined) stored.lastStep = step;
    else stored.recovery.splice(recovery, 1);
    delete throttle[key];
    setSetting(db, credentialsKey, JSON.stringify(stored));
    setSetting(db, throttleKey, JSON.stringify(throttle));
    return { token: createSession(db, now) };
  }, { behavior: "immediate" });
}
