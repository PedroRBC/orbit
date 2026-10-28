import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "../db/index";
import { sessionCookie, sessionValid } from "./auth";

export async function hasSession() { return sessionValid(getDatabase(), (await cookies()).get(sessionCookie)?.value); }
// Toda página protegida, Server Action e rota chama isto: o proxy só confere a presença do cookie.
export async function requireSession() { if (!await hasSession()) redirect("/login"); }
// Só caminhos internos: sem "//", "/\" nem caracteres de controle (o parser de URL apaga tabs e quebras).
export function safeNext(value: unknown) {
  return typeof value === "string" && value.length <= 2000 && /^\/(?![/\\])[^\x00-\x1f\x7f]*$/.test(value) && !value.startsWith("/login") ? value : "/";
}
