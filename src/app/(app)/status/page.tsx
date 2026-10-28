import { connection } from "next/server";
import { requireSession } from "../../../lib/session";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { Activity, ShieldCheck } from "lucide-react";
import { getDatabase } from "../../../db/index";
import { collectorRuns, processedItems, rawItems, sources } from "../../../db/schema";
import { connectionStatus } from "../../../lib/extension";
import { readSchedule } from "../../../lib/scheduler";
import { aiStatus } from "../../../lib/config";
import { dailyUsage, getSetting, workerOnline as isWorkerOnline } from "../../../lib/store";
import { CollectButton, WorkRefresh } from "../../components";
import { runLabels as labels } from "../../../lib/run-labels";

export const metadata = { title: "Status" };
export default async function StatusPage() {
  await requireSession();
  await connection();
  const db = getDatabase(), ai = aiStatus(), extension = connectionStatus(db), usage = dailyUsage(db), schedule = readSchedule(db);
  const next = getSetting(db, "scheduler_next");
  const tokensRemaining = Math.max(0, ai.tokenLimit - usage.tokens);
  const dollarsRemaining = ai.costLimit !== null && usage.cost !== null ? Math.max(0, ai.costLimit - usage.cost) : null;
  const budgetExhausted = tokensRemaining === 0 || (ai.costLimit !== null && dollarsRemaining === 0);
  const unknownCost = ai.costLimit !== null && usage.calls > 0 && usage.cost === null;
  const runs = db.select({ run: collectorRuns, source: sources.name }).from(collectorRuns).leftJoin(sources, eq(sources.id, collectorRuns.sourceId)).orderBy(desc(collectorRuns.id)).limit(30).all();
  const workerOnline = isWorkerOnline(db);
  const pending = db.select({ count: sql<number>`count(*)` }).from(rawItems).leftJoin(processedItems, eq(rawItems.id, processedItems.rawId)).where(isNull(processedItems.rawId)).get()?.count ?? 0;
  const active = runs.some(({ run }) => ["queued", "running"].includes(run.status));
  const storedNotice = getSetting(db, "ai_notice"), storedBriefingNotice = getSetting(db, "briefing_notice");
  const briefingNotice = ai.briefingReady && /^Configure AI_BRIEFING_MODEL/.test(storedBriefingNotice || "") ? undefined : storedBriefingNotice;
  const notice = ai.ready && /^(IA não configurada|Configuração de IA inválida|AI_BASE_URL)/.test(storedNotice || "") ? undefined : storedNotice;
  return <>
    <WorkRefresh active={active || !workerOnline}/>
    <div className="page-heading"><div><h1>Tudo às claras.</h1><p>O que está funcionando, o que chegou e o que precisa de você.</p></div><CollectButton/></div>
    <section className="panel"><h2>Operação</h2><dl className="detail-list">
      <div><dt>Worker</dt><dd className={workerOnline ? "success-text" : "warning-text"}><span className="dot"/>{workerOnline ? "Online" : "Sem sinal recente"}</dd></div>
      <div><dt>Navegador habitual</dt><dd><a className="text-link" href="/conectar">{extension.online ? "Extensão online" : extension.paired ? "Abra o navegador com a extensão" : "Conectar extensão"}</a></dd></div>
      <div><dt>IA</dt><dd>{ai.message}</dd></div>
      <div><dt>Itens aguardando análise</dt><dd>{pending}</dd></div>
      <div><dt>Agendamento</dt><dd>{schedule.error || (schedule.enabled ? `${schedule.expression} · ${schedule.timezone}` : "Pausado; coleta manual disponível")}</dd></div>
      {schedule.enabled && next && <div><dt>Próximo horário</dt><dd>{new Date(next).toLocaleString("pt-BR", { timeZone: schedule.timezone })}</dd></div>}
      <div><dt>Limite automático</dt><dd>{schedule.maxRuns} execuções / 24 h</dd></div>
    </dl><p className="field-help">Intervalo mínimo de cinco minutos, sem sobreposição. Fontes com Retry-After permanecem pausadas; RSS continua independente do navegador.</p></section>
    {notice && <div className="notice"><Activity size={18}/><div><strong>Último aviso da análise</strong><p>{notice}</p></div></div>}
    {briefingNotice && <div className="notice"><Activity size={18}/><div><strong>Último aviso do briefing</strong><p>{briefingNotice}</p></div></div>}
    <section className="panel budget-panel"><h2>Consumo de hoje</h2><p>Dia UTC · {new Date().toISOString().slice(0, 10)}</p>
      {budgetExhausted && <p className="warning-text" role="status">Teto diário atingido. Chamadas acima do saldo são recusadas; coleta e dados anteriores continuam disponíveis.</p>}
      {unknownCost && <p className="warning-text" role="status">Há chamadas de custo desconhecido. Com teto em USD, novas chamadas ficam bloqueadas por segurança até renovar o dia ou corrigir os preços/limites.</p>}
      <progress className="budget-meter" aria-label="Consumo do teto diário em tokens" max={ai.tokenLimit} value={Math.min(usage.tokens, ai.tokenLimit)} title={`${usage.tokens} tokens usados ou reservados de ${ai.tokenLimit}`}/>
      <dl className="detail-list">
        <div><dt>Tokens usados ou reservados</dt><dd>{usage.tokens.toLocaleString("pt-BR")} / {ai.tokenLimit.toLocaleString("pt-BR")}</dd></div>
        <div><dt>Tokens ainda disponíveis</dt><dd>{tokensRemaining.toLocaleString("pt-BR")}</dd></div>
        <div><dt>Estimativa em USD</dt><dd>{usage.cost === null ? "Indisponível — sem preços ou consumo confirmado" : `$${usage.cost.toFixed(4)}`}</dd></div>
        <div><dt>Teto diário em USD</dt><dd>{ai.costLimit === null ? "Não definido; teto em tokens ativo" : `$${ai.costLimit.toFixed(4)}`}</dd></div>
        {dollarsRemaining !== null && <div><dt>Saldo estimado em USD</dt><dd>${dollarsRemaining.toFixed(4)}</dd></div>}
        <div><dt>Chamadas registradas</dt><dd>{usage.calls}</dd></div>
        <div><dt>Reservas sem uso confirmado</dt><dd>{usage.reserved}</dd></div>
      </dl><div className="inline-note"><ShieldCheck size={17}/><p>Reserva antes de cada chamada, incluindo retentativas. Uso ausente ou falha de rede mantém a reserva. O teto é local e estimado: configure também limites no fornecedor. Preços e chaves ficam no .env.</p></div>
    </section>
    <section><div className="section-heading"><div><h2>Histórico de coletas</h2><p>Falhas de uma fonte não interrompem as outras.</p></div></div>
      {runs.length ? <div className="table-scroll"><table><thead><tr><th>Fonte</th><th>Origem</th><th>Estado</th><th>Início</th><th>Duração</th><th>Novos itens</th><th>Detalhes</th></tr></thead><tbody>{runs.map(({ run, source }) => <tr key={run.id}><td>{source || "Atualização geral"}</td><td>{run.parentId ? "Fonte" : run.trigger === "scheduled" ? "Agenda" : "Manual"}</td><td><span className={`run-state ${run.status}`}>{labels[run.status] || run.status}</span></td><td>{new Date(run.startedAt).toLocaleString("pt-BR")}</td><td>{run.finishedAt ? `${Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))} s` : "—"}</td><td>{run.itemCount}</td><td className="run-details">{run.error || "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><Activity size={28}/><h3>Nenhuma coleta por enquanto.</h3><p>Adicione fontes e solicite uma atualização.</p></div>}
    </section>
  </>;
}
