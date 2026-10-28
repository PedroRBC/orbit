"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db/index";
import { collectorRuns, interestProfile, settings, sources } from "../db/schema";
import { normalizeChannel } from "../collectors/youtube";
import { publicFeedURL } from "../lib/public-feed";
import { validSchedule } from "../lib/scheduler";
import { setSetting } from "../lib/store";
import { createPairingCode, revokeExtension } from "../lib/extension";
import { browserSourceKinds, browserSourceLabels, browserURLs } from "../collectors/types";
import { enqueueCollection } from "../lib/store";
import { revokeAllSessions, revokeSession, sessionCookie } from "../lib/auth";
import { requireSession } from "../lib/session";
import { applyFeedback, feedbackAction, updateTopicWeight } from "../lib/feedback";

export type ActionResult = { message: string; error?: boolean; code?: string };
function refresh() { for (const path of ["/", "/fontes", "/configuracoes", "/status", "/perfil"]) revalidatePath(path); }

export async function saveProfile(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const data = z.object({ interests: z.string().trim().min(1).max(2000), excluded: z.string().trim().max(2000) }).safeParse({ interests: form.get("interests"), excluded: form.get("excluded") ?? "" });
  if (!data.success) return { error: true, message: "Informe seus interesses. Cada campo aceita até 2.000 caracteres." };
  const values = { ...data.data, updatedAt: Date.now() };
  getDatabase().insert(interestProfile).values({ id: 1, ...values }).onConflictDoUpdate({ target: interestProfile.id, set: values }).run();
  refresh();
  return { message: "Interesses salvos. Serão usados nos próximos itens analisados." };
}

export async function addSource(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ name: z.string().trim().min(1).max(120), channel: z.string().trim().min(1).max(500) }).safeParse({ name: form.get("name"), channel: form.get("channel") });
  if (!parsed.success) return { error: true, message: "Informe um nome de até 120 caracteres e o ID ou URL do canal." };
  let channelId: string;
  try { channelId = normalizeChannel(parsed.data.channel); }
  catch { return { error: true, message: "Use o ID que começa com UC ou a URL youtube.com/channel/UC…. Links @handle ainda não são aceitos pelo RSS." }; }
  const db = getDatabase();
  if (db.select().from(sources).where(eq(sources.channelId, channelId)).get()) return { error: true, message: "Esse canal já está na sua lista." };
  if (db.select().from(sources).where(eq(sources.kind, "youtube_rss")).all().length >= 25) return { error: true, message: "A fase 1 aceita até 25 canais para manter a coleta leve." };
  db.insert(sources).values({ channelId, name: parsed.data.name }).run();
  refresh();
  return { message: "Canal adicionado. Use Atualizar fontes para coletar os vídeos." };
}

export async function addNewsSource(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ name: z.string().trim().min(1).max(120), url: z.string().trim().min(1).max(2048) }).safeParse({ name: form.get("name"), url: form.get("url") });
  if (!parsed.success) return { error: true, message: "Informe um nome e uma URL HTTPS de RSS público." };
  let url: URL;
  try { url = publicFeedURL(parsed.data.url); } catch { return { error: true, message: "Use RSS público HTTPS, sem credenciais, IP ou rede local." }; }
  const db = getDatabase();
  if (db.select().from(sources).where(eq(sources.channelId, url.href)).get()) return { error: true, message: "Essa fonte já foi cadastrada." };
  if (db.select().from(sources).where(eq(sources.kind, "news_rss")).all().length >= 10) return { error: true, message: "Limite de dez portais RSS para manter a coleta leve." };
  db.insert(sources).values({ channelId: url.href, name: parsed.data.name, kind: "news_rss", platform: "news" }).run();
  refresh(); return { message: "RSS externo adicionado. Ele aparecerá somente em Fora da bolha após coleta e análise." };
}
export async function saveSchedule(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ expression: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(100) }).safeParse({ expression: form.get("expression"), timezone: form.get("timezone") });
  if (!parsed.success) return { error: true, message: "Informe expressão cron e fuso válidos." };
  try { validSchedule(parsed.data.expression, parsed.data.timezone); } catch { return { error: true, message: "Cron ou fuso inválido. Exemplo: 0 8,14,20 * * * e America/Sao_Paulo." }; }
  const db = getDatabase();
  db.transaction(() => { setSetting(db, "scheduler_config", JSON.stringify({ ...parsed.data, enabled: form.get("enabled") === "on" })); db.delete(settings).where(eq(settings.key, "scheduler_enabled")).run(); }, { behavior: "immediate" });
  refresh(); return { message: "Agenda salva. O worker aplica mudanças após a execução atual; não faz coleta retroativa." };
}

export async function beginPairing(): Promise<ActionResult> {
  await requireSession();
  return { message: "Código gerado. Cole no popup da extensão em até 10 minutos. Não compartilhe esse código.", code: createPairingCode(getDatabase()) };
}
export async function disconnectExtension(): Promise<ActionResult> {
  await requireSession();
  revokeExtension(getDatabase()); refresh(); revalidatePath("/conectar");
  return { message: "Conexão revogada. A extensão não pode mais receber pedidos nem enviar resultados." };
}
export async function enableBrowserSource(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const platform = z.enum(["youtube", "x", "instagram", "valete"]).safeParse(form.get("platform"));
  if (!platform.success) return { error: true, message: "Plataforma inválida." };
  const values = { name: browserSourceLabels[platform.data], kind: browserSourceKinds[platform.data], platform: platform.data, enabled: true };
  getDatabase().insert(sources).values({ channelId: browserURLs[platform.data], ...values }).onConflictDoUpdate({ target: sources.channelId, set: values }).run();
  refresh();
  return { message: "Fonte ativada. Entre normalmente no site pelo seu navegador, mantenha a extensão conectada e solicite Atualizar fontes." };
}

export async function toggleSource(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const id = z.coerce.number().int().positive().safeParse(form.get("id"));
  if (!id.success) return { error: true, message: "Canal inválido." };
  const db = getDatabase();
  const source = db.select().from(sources).where(eq(sources.id, id.data)).get();
  if (!source) return { error: true, message: "Canal não encontrado." };
  db.update(sources).set({ enabled: !source.enabled }).where(eq(sources.id, source.id)).run();
  refresh();
  return { message: source.enabled ? "Fonte pausada. Os dados foram preservados." : "Fonte ativada." };
}

export async function saveFeedback(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ rawId: z.string().min(1).max(500), action: feedbackAction.exclude(["click"]) }).safeParse({ rawId: form.get("rawId"), action: form.get("action") });
  if (!parsed.success) return { error: true, message: "Feedback inválido." };
  try { applyFeedback(getDatabase(), parsed.data.rawId, parsed.data.action); }
  catch { return { error: true, message: "Não foi possível salvar. Confira se o item e seu perfil ainda existem." }; }
  refresh();
  return { message: "Feedback salvo. Seu perfil e a ordem das recomendações foram atualizados." };
}

export async function recordClick(rawId: string): Promise<void> {
  await requireSession();
  if (!z.string().min(1).max(500).safeParse(rawId).success) return;
  try { applyFeedback(getDatabase(), rawId, "click"); refresh(); } catch { /* Abrir a fonte não depende do registro de feedback. */ }
}

export async function saveTopicWeight(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = z.object({ theme: z.string().min(1).max(80), weight: z.coerce.number().int().min(-20).max(20) }).safeParse({ theme: form.get("theme"), weight: form.get("weight") });
  if (!parsed.success) return { error: true, message: "Use um peso inteiro entre -20 e 20." };
  try { updateTopicWeight(getDatabase(), parsed.data.theme, parsed.data.weight); }
  catch { return { error: true, message: "Configure seu perfil antes de ajustar os pesos." }; }
  refresh();
  return { message: "Peso atualizado. Você continua no controle das preferências." };
}

export async function requestCollection(): Promise<ActionResult> {
  await requireSession();
  const db = getDatabase();
  const last = db.select().from(collectorRuns).where(isNull(collectorRuns.parentId)).orderBy(desc(collectorRuns.id)).get();
  if (last?.finishedAt && Date.now() - last.finishedAt < 5 * 60_000) return { error: true, message: "Aguarde cinco minutos entre atualizações para respeitar as fontes e o orçamento." };
  enqueueCollection(db);
  refresh();
  return { message: "Atualização na fila. O worker fará a coleta e analisará os itens pendentes." };
}

export async function logout(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await requireSession();
  const store = await cookies(), db = getDatabase();
  if (form.get("scope") === "all") revokeAllSessions(db);
  else revokeSession(db, store.get(sessionCookie)?.value);
  // Prefixo __Host- exige os mesmos atributos também para apagar o cookie.
  store.set(sessionCookie, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  redirect("/login");
}
