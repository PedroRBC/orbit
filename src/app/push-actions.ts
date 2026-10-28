"use server";

import { getDatabase } from "../db/index";
import { requireSession } from "../lib/session";
import { PushError, pushConfiguration, queuePushTest, removePushSubscription, savePushSubscription, type PushConfiguration } from "../lib/push";
import type { ActionResult } from "./actions";

function failure(error: unknown): ActionResult {
  return { error: true, message: error instanceof PushError ? error.message : "Não foi possível alterar as notificações. Tente novamente." };
}
export async function getPushConfiguration(endpoint: string | null = null): Promise<PushConfiguration> {
  await requireSession();
  try { return pushConfiguration(getDatabase(), endpoint); }
  catch { return { publicKey: null, subscribed: false, message: "Não foi possível consultar as notificações. Tente novamente." }; }
}
export async function subscribePush(serialized: string): Promise<ActionResult> {
  await requireSession();
  try { savePushSubscription(getDatabase(), serialized); return { message: "Notificações ativadas neste aparelho." }; }
  catch (error) { return failure(error); }
}
export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  await requireSession();
  try { removePushSubscription(getDatabase(), endpoint); return { message: "Notificações desativadas neste aparelho." }; }
  catch (error) { return failure(error); }
}
export async function testPush(endpoint: string, editionId: number | null): Promise<ActionResult> {
  await requireSession();
  try { queuePushTest(getDatabase(), endpoint, editionId); return { message: "Teste na fila do worker. Você pode fechar o Orbit; a entrega depende do navegador e do sistema." }; }
  catch (error) { return failure(error); }
}
