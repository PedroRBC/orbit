import { connection } from "next/server";
import { requireSession } from "../../../lib/session";
import { LockKeyhole, ArrowUpRight } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { editions } from "../../../db/schema";
import { getDatabase } from "../../../db/index";
import { getProfile } from "../../../lib/store";
import { readSchedule } from "../../../lib/scheduler";
import { readEditionSchedule } from "../../../lib/editions";
import { aiStatus } from "../../../lib/config";
import { logout, saveEditionSchedule, saveProfile, saveSchedule } from "../../actions";
import { ActionForm, SubmitButton } from "../../components";
import { PushSettings } from "../../push-settings";

export const metadata = { title: "Configurações" };
export default async function SettingsPage() {
  await requireSession();
  await connection();
  const db = getDatabase();
  const profile = getProfile(db);
  const ai = aiStatus();
  const schedule = readSchedule(db);
  const editionSchedule = readEditionSchedule(db);
  const latestEdition = db.select({ id: editions.id }).from(editions).where(eq(editions.status, "published")).orderBy(desc(editions.id)).get();
  return <>
    <div className="page-heading"><div><h1>Configurações</h1><p>Agenda, notificações e conexões. Suas escolhas permanecem privadas.</p></div></div>
    <section className="panel edition-schedule" id="edicoes">
      <h2>Briefings gerais</h2>
      <p>Dois fechamentos diários: <strong>08h e 16h</strong>. Panorama pela manhã; novidades desde 08h à tarde.</p>
      <p>RSS públicos são coletados pelo servidor, sem extensão ou navegador aberto. <a href="/fontes#noticias">Escolher fontes públicas</a>.</p>
      {editionSchedule.needsTimezone && <p className="warning-text">Nenhum fuso foi confirmado. Proposta: <strong>America/Sao_Paulo</strong>. Revise e ative a agenda abaixo.</p>}
      {editionSchedule.error && <p role="alert" className="warning-text">{editionSchedule.error}</p>}
      <ActionForm action={saveEditionSchedule} className="stack-form">
        <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked={editionSchedule.enabled}/>Edições gerais automáticas</label>
        <label htmlFor="edition-timezone">Fuso das edições</label>
        <input id="edition-timezone" name="timezone" required maxLength={100} defaultValue={editionSchedule.timezone}/>
        <p className="field-help">Fuso atual: {editionSchedule.timezone}. Esta agenda é independente da coleta pessoal. Se o servidor voltar em até duas horas, recupera somente a edição recente. Não gera um lote de edições perdidas.</p>
        <SubmitButton>Salvar agenda dos briefings</SubmitButton>
      </ActionForm>
      <p className="field-help">As edições compartilham o modelo de briefing e o orçamento de IA. Sem fontes recentes ou configuração válida, o arquivo mostra o motivo, sem notícias inventadas. <a href="/briefings">Consultar arquivo</a>.</p>
    </section>
    <PushSettings editionId={latestEdition?.id ?? null}/>
    <section className="panel interests-panel">
      <h2>Interesses pessoais</h2><p>Orientam as próximas análises do seu feed, não o briefing geral. Itens já classificados não serão reprocessados.</p>
      <ActionForm action={saveProfile} className="stack-form">
        <label htmlFor="interests">Seus interesses</label>
        <textarea id="interests" name="interests" rows={4} required maxLength={2000} defaultValue={profile?.interests ?? ""} placeholder="Assuntos e áreas que você quer acompanhar"/>
        <label htmlFor="excluded">O que você prefere evitar</label>
        <textarea id="excluded" name="excluded" rows={3} maxLength={2000} defaultValue={profile?.excluded ?? ""}/>
        <SubmitButton>Salvar interesses</SubmitButton>
      </ActionForm>
      <p className="field-help">Nenhuma preferência vem preenchida. <a href="/perfil#temas">Veja os temas e ajuste os pesos do feedback</a>.</p>
    </section>
    <section className="panel ai-panel" id="ia">
      <div className="section-heading"><div><h2>Conexão de IA</h2><p>URL e chave ficam somente no servidor.</p></div><span className={`state-label ${ai.ready ? "success-text" : "warning-text"}`}><span className="dot"/>{ai.ready ? "Configurada" : ai.state === "invalid" ? "Configuração inválida" : "Aguardando configuração"}</span></div>
      {ai.ready && <dl className="detail-list"><div><dt>Protocolo</dt><dd>{ai.protocol === "openai" ? "OpenAI Compatible" : "Anthropic Compatible"}</dd></div><div><dt>Modelo</dt><dd>{ai.model}</dd></div></dl>}
      {ai.state === "invalid" && <p className="warning-text" role="alert">{ai.message}</p>}
      <p>No Docker, preencha <code>/config/orbit.env</code>; fora dele, copie <code>.env.example</code> para <code>.env</code>. Parâmetros de IA são relidos automaticamente. Portas, contato de push e outros parâmetros de inicialização exigem reiniciar o app.</p>
      <div className="protocol-examples"><div><h3>OpenAI Compatible</h3><pre>{`AI_PROTOCOL=openai\nAI_BASE_URL=https://seu-endpoint.example/v1\nAI_API_KEY=sua-chave\nAI_MODEL=id-do-seu-modelo`}</pre></div><div><h3>Anthropic Compatible</h3><pre>{`AI_PROTOCOL=anthropic\nAI_BASE_URL=https://seu-endpoint.example\nAI_API_KEY=sua-chave\nAI_MODEL=id-do-seu-modelo`}</pre></div></div>
      <p className="field-help">A URL aceita HTTP ou HTTPS, inclusive IP da rede local ou nome do serviço Docker. HTTP envia chave e textos sem criptografia: use apenas em rede confiável. Inclua o prefixo exigido pelo serviço; o SDK Anthropic acrescenta /v1/messages. Você define os modelos; não há troca automática de fornecedor.</p>
      <h3>Modelo de briefing</h3>
      <p className="field-help">{ai.briefingReady ? "Configuração do modelo de briefing carregada." : "Modelo de briefing ainda não configurado ou inválido."}</p>
      <p>Defina <code>AI_BRIEFING_MODEL</code> para os briefings pessoal e geral. Ambos usam o protocolo, a URL e a chave escolhidos por você.</p>
      <pre>{`AI_BRIEFING_MODEL=id-do-modelo-de-briefing\nAI_BRIEFING_INPUT_USD_PER_MILLION=\nAI_BRIEFING_OUTPUT_USD_PER_MILLION=`}</pre>
      <p className="field-help">Com teto em USD, informe os preços próprios do modelo. Classificação e briefings compartilham o orçamento diário.</p>
      <div className="notice privacy-note"><LockKeyhole size={19} aria-hidden="true"/><div><strong>Sua chave nunca aparece na interface.</strong><p>Somente os textos e metadados necessários seguem para o endpoint escolhido. Suas preferências pessoais não entram no briefing geral. A política de privacidade é a desse fornecedor.</p></div></div>
      <p className="field-help">Configure <code>AI_DAILY_TOKEN_LIMIT</code> para limitar o consumo. Sem preços explícitos, custo é desconhecido, não zero. <a href="/status">Ver consumo e status <ArrowUpRight size={13} aria-hidden="true"/></a></p>
    </section>
    <section className="panel schedule-panel">
      <h2>Coleta pessoal</h2><p>Padrão: 08h, 14h e 20h. Fuso desta agenda: {schedule.timezone}. Feeds pessoais precisam do navegador com a extensão aberto; RSS são coletados no servidor.</p>
      {schedule.error && <p role="alert" className="warning-text">{schedule.error}</p>}
      <ActionForm action={saveSchedule} className="stack-form">
        <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked={schedule.enabled}/>Agendamento de coleta ativo</label>
        <label htmlFor="cron">Horários (cron)</label><input id="cron" name="expression" required maxLength={120} defaultValue={schedule.expression}/>
        <label htmlFor="timezone">Fuso da coleta</label><input id="timezone" name="timezone" required maxLength={100} defaultValue={schedule.timezone}/>
        <p className="field-help">Sem lote retroativo. Intervalo mínimo de cinco minutos, sem sobreposição. Limite: {schedule.maxRuns} coletas automáticas a cada 24 horas, configurável em COLLECTOR_MAX_RUNS_PER_DAY (1–12). Edições gerais têm sua própria agenda acima.</p>
        <SubmitButton>Salvar agenda</SubmitButton>
      </ActionForm>
    </section>
    <section className="panel access-panel"><h2>Acesso</h2><p>Sessões duram 30 dias. Para trocar a senha ou o autenticador, rode <code>npm run auth -- setup</code> no servidor; isso encerra todas as sessões.</p><div className="access-actions"><ActionForm action={logout}><SubmitButton className="button secondary">Sair deste dispositivo</SubmitButton></ActionForm><ActionForm action={logout}><input type="hidden" name="scope" value="all"/><SubmitButton className="button secondary">Sair de todos os dispositivos</SubmitButton></ActionForm></div></section>
  </>;
}
