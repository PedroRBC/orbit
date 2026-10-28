import { eq } from "drizzle-orm";
import type { OrbitDB } from "../db/index";
import { collectorRuns, companionJobs, sources } from "../db/schema";
import type { RawItem } from "../collectors/types";
import { collectorForSource } from "../collectors/registry";
import { CollectorError } from "../collectors/errors";
import { classifyPending } from "../ai/classify";
import { readAIEnvironment } from "./ai-environment";
import { AIConfigurationError, getAIConfig, getBriefingConfig, type AIConfig } from "./config";
import { generateBriefing } from "../ai/briefing";
import { runEdition } from "../ai/edition";
import { getProfile, saveRawItems, setSetting } from "./store";

type RunControl = { assertActive?: () => void; signal?: AbortSignal };
type Collect = (channel: string, signal?: AbortSignal) => Promise<RawItem[]>;

export async function runWithConfiguredAI(db: OrbitDB, runId: number, collect?: Collect, control: RunControl = {}) {
  let env: Record<string, string | undefined> | null = null;
  let config: AIConfig | null = null;
  let configNotice: string | undefined;
  try { env = readAIEnvironment(); config = getAIConfig(env); }
  catch (error) { configNotice = error instanceof AIConfigurationError ? error.message : "Configuração de IA inválida. Corrija o .env (orbit.env no Docker); a coleta continua normalmente."; }
  let briefingConfig: AIConfig | null = null;
  let briefingNotice: string | undefined;
  try { briefingConfig = env ? getBriefingConfig(env) : null; }
  catch { briefingNotice = "Configuração de briefing inválida. Confira modelo e preços próprios no .env (orbit.env no Docker)."; }
  if (db.select().from(collectorRuns).where(eq(collectorRuns.id, runId)).get()?.kind === "edition") return runEdition(db, runId, briefingConfig, control);
  return runCollection(db, runId, { config, collect, configNotice, briefingConfig, briefingNotice, ...control });
}

export async function runCollection(db: OrbitDB, runId: number, dependencies: RunControl & { collect?: Collect; config: AIConfig | null; configNotice?: string; briefingConfig?: AIConfig | null; briefingNotice?: string }) {
  const assertActive = () => { dependencies.signal?.throwIfAborted(); dependencies.assertActive?.(); };
  const owned = <T>(operation: () => T): T => db.transaction(() => { assertActive(); return operation(); }, { behavior: "immediate" });
  assertActive();
  const channels = db.select().from(sources).where(eq(sources.enabled, true)).all();
  let failures = 0;
  let count = 0;
  for (const source of channels) {
    if (source.cooldownUntil && source.cooldownUntil > Date.now()) {
      failures++;
      owned(() => db.insert(collectorRuns).values({ sourceId: source.id, parentId: runId, status: "rate_limited", startedAt: Date.now(), finishedAt: Date.now(), error: `Fonte em pausa até ${new Date(source.cooldownUntil!).toLocaleString("pt-BR")} conforme Retry-After.` }).run());
      continue;
    }
    const run = owned(() => db.insert(collectorRuns).values({ sourceId: source.id, parentId: runId, status: "running", startedAt: Date.now() }).returning().get());
    try {
      assertActive();
      const items = dependencies.collect ? await dependencies.collect(source.channelId, dependencies.signal) : await collectorForSource(source, db, run.id, dependencies.signal, assertActive).collect();
      const inserted = owned(() => {
        const inserted = saveRawItems(db, source.id, items);
        db.delete(companionJobs).where(eq(companionJobs.runId, run.id)).run();
        db.update(collectorRuns).set({ status: "completed", finishedAt: Date.now(), itemCount: inserted }).where(eq(collectorRuns.id, run.id)).run();
        return inserted;
      });
      count += inserted;
    } catch (error) {
      assertActive();
      failures++;
      if (error instanceof CollectorError && error.code === "rate_limited") owned(() => db.update(sources).set({ cooldownUntil: Date.now() + (error.retryAfterMs || 15 * 60_000) }).where(eq(sources.id, source.id)).run());
      const status = error instanceof CollectorError ? error.code : "error";
      const message = error instanceof CollectorError ? error.message : "Não foi possível coletar a fonte. Verifique configuração, sessão, rede e disponibilidade da plataforma.";
      owned(() => db.update(collectorRuns).set({ status, finishedAt: Date.now(), error: message }).where(eq(collectorRuns.id, run.id)).run());
    }
    if (channels.length > 1) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  let notice: string | null = null;
  assertActive();
  if (!dependencies.config) notice = dependencies.configNotice || "IA não configurada. Os itens coletados permanecem disponíveis para análise posterior.";
  else {
    try {
      await classifyPending(db, dependencies.config, assertActive, dependencies.signal);
      owned(() => setSetting(db, "ai_notice", getProfile(db)?.interests.trim() ? "" : "Configure seus interesses para classificar os itens do seu feed pessoal. Notícias externas podem usar análise geral."));
    } catch (error) {
      assertActive();
      failures++;
      // Nunca persistir a mensagem do SDK: serviços externos podem repetir credenciais ou conteúdo.
      notice = error instanceof Error && /^(Limite diário|A IA retornou JSON)/.test(error.message) ? error.message : "Falha na IA. Confira URL, chave, modelo e compatibilidade do endpoint. Itens preservados; uso desconhecido continua reservado.";
    }
  }
  if (dependencies.briefingConfig) {
    try { await generateBriefing(db, dependencies.briefingConfig, assertActive, dependencies.signal); owned(() => setSetting(db, "briefing_notice", "")); }
    catch (error) {
      assertActive(); failures++;
      const message = error instanceof Error && /^(Limite diário|A IA retornou JSON)/.test(error.message) ? error.message : "Falha ao gerar briefing. Dados e briefing anterior preservados; confira o endpoint e o modelo.";
      owned(() => setSetting(db, "briefing_notice", message));
    }
  } else owned(() => setSetting(db, "briefing_notice", dependencies.briefingNotice || "Configure AI_BRIEFING_MODEL no .env (orbit.env no Docker) para habilitar o briefing."));
  if (notice) owned(() => setSetting(db, "ai_notice", notice));
  owned(() => db.update(collectorRuns).set({ status: failures ? "partial" : "completed", finishedAt: Date.now(), itemCount: count, error: failures ? `${failures} etapa(s) falharam. Consulte as fontes e o aviso de IA.` : notice }).where(eq(collectorRuns.id, runId)).run());
}
