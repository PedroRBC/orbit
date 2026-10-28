import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "../db/index";
import { sessionCookie, sessionValid } from "./auth";

export async function hasSession() { return sessionValid(getDatabase(), (await cookies()).get(sessionCookie)?.value); }
// Toda página protegida, Server Action e rota chama isto: o proxy só confere a presença do cookie.
export async function requireSession() { if (!await hasSession()) redirect("/login"); }
// Só caminhos internos: evita redirecionamento aberto para outro domínio após o login.
export function safeNext(value: unknown) {
  return typeof value === "string" && value.length <= 2000 && /^\/(?![/\\])/.test(value) && !value.startsWith("/login") ? value : "/";
}
