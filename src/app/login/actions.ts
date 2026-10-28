"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "../../db/index";
import { attemptLogin, sessionCookie, sessionMaxAge } from "../../lib/auth";
import { loginClient, requestOrigin } from "../../lib/hosts";
import { safeNext } from "../../lib/session";
import type { ActionResult } from "../actions";

export async function login(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const request = await headers();
  if (!requestOrigin(request)) return { error: true, message: "Abra o Orbit por HTTPS para entrar." };
  const input = z.object({ password: z.string().min(1).max(1024), code: z.string().trim().min(1).max(20), next: z.string().max(2000).optional() }).safeParse({ password: form.get("password"), code: form.get("code"), next: form.get("next") ?? undefined });
  if (!input.success) return { error: true, message: "Informe a senha e o código do autenticador." };
  const result = attemptLogin(getDatabase(), { password: input.data.password, code: input.data.code, client: loginClient(request) });
  if ("error" in result) return { error: true, message: result.error };
  (await cookies()).set(sessionCookie, result.token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: sessionMaxAge });
  redirect(safeNext(input.data.next));
}
