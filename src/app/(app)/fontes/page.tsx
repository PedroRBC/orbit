import { connection } from "next/server";
import { requireSession } from "../../../lib/session";
import Link from "next/link";
import { connectionStatus } from "../../../lib/extension";
import { sql } from "drizzle-orm";
import { Radio, Youtube, Pause, Play, ArrowUpRight, Globe } from "lucide-react";
import { getDatabase } from "../../../db/index";
import { browserSourceKinds, browserSourceLabels, browserURLs } from "../../../collectors/types";
import { collectorRuns, sources } from "../../../db/schema";
import { addNewsSource, addSource, enableBrowserSource, toggleSource } from "../../actions";
import { ActionForm, CollectButton, SubmitButton } from "../../components";
import { runLabels } from "../../../lib/run-labels";

type Run = typeof collectorRuns.$inferSelect;
function LastRun({ run }: { run?: Run }) {
  if (!run) return <p className="field-help">Ainda sem coleta.</p>;
  const failed = !!run.error && run.status !== "completed";
  return <p className={`field-help${failed ? " warning-text" : ""}`}>Última coleta: {new Date(run.startedAt).toLocaleString("pt-BR")} · {runLabels[run.status] || run.status}{failed ? ` — ${run.error}` : ""}</p>;
}

export const metadata = { title: "Fontes" };
export default async function SourcesPage() {
  await requireSession();
  await connection();
  const db = getDatabase();
  const all = db.select().from(sources).all();
  const extension = connectionStatus(db);
  const lastRuns = new Map(db.select().from(collectorRuns).where(sql`${collectorRuns.id} IN (SELECT max(id) FROM collector_runs WHERE sourceId IS NOT NULL GROUP BY sourceId)`).all().map(run => [run.sourceId, run]));
  const news = all.filter(source => source.kind === "news_rss");
  const channels = all.filter(source => source.kind === "youtube_rss");
  return <>
    <div className="page-heading"><div><h1>Suas fontes.</h1><p>O ponto de partida da sua curadoria.</p></div><CollectButton/></div>
    <div className="notice"><div><strong>{extension.online ? "Seu navegador está conectado ao Orbit." : "Conecte seu navegador habitual."}</strong><p>Faça login normalmente no Helium e conecte a extensão Orbit. Sem Chromium automatizado e sem exportar cookies.</p><Link href="/conectar">{extension.paired ? "Ver conexão do navegador" : "Instalar e conectar extensão"}</Link></div></div>
    <section className="browser-sources"><div className="section-heading"><div><h2>Seus feeds pessoais</h2><p>Dependem do Helium aberto, com a extensão, no seu computador. Sem ele, o Orbit mantém o que já coletou e avisa na fonte.</p></div><Globe size={22}/></div>
      <div className="browser-source-list">{(["youtube", "x", "instagram", "valete"] as const).map(platform => {
        const source = all.find(source => source.kind === browserSourceKinds[platform]);
        const name = browserSourceLabels[platform];
        return <section className="panel browser-source" key={platform}><h3>{name}</h3><p>{platform === "youtube" ? "Vídeos recomendados na sua home, com os metadados visíveis." : platform === "x" ? "Posts da aba Para você, sem usar Seguindo como alternativa." : platform === "instagram" ? "Posts e legendas reconhecidas do feed, sem comentários ou stories." : "Feed geral pela API documentada. Somente permalinks reais observados."}</p><a className="button secondary" href={browserURLs[platform]} target="_blank" rel="noopener noreferrer">Abrir {name}<ArrowUpRight size={14} aria-hidden="true"/></a><p className="field-help">Abra no navegador onde a extensão Orbit está instalada e entre normalmente.</p><span className={`state-label ${source?.enabled ? "success-text" : "muted"}`}><span className="dot"/>{source?.enabled ? "Fonte ativa" : "Desativada"}</span>{source && <LastRun run={lastRuns.get(source.id)}/>}
          {source?.enabled ? <ActionForm action={toggleSource}><input type="hidden" name="id" value={source.id}/><SubmitButton className="button secondary" label={`Pausar fonte ${name}`}>Pausar fonte</SubmitButton></ActionForm> : <ActionForm action={enableBrowserSource}><input type="hidden" name="platform" value={platform}/><SubmitButton className="button secondary" label={`Ativar fonte ${name}`}>Ativar fonte</SubmitButton></ActionForm>}
        </section>;
      })}</div><div className="inline-note">Somente leitura: nenhuma curtida, comentário, publicação ou follow. Verificação/CAPTCHA interrompe a fonte. Automatizar plataformas pode violar seus termos e causar restrição da conta.</div>
    </section>
    <div className="split-layout"><section><div className="section-heading"><div><h2>Canais do YouTube</h2><p>RSS oficial, coletado pelo servidor, mesmo com o computador desligado. Sem login nem acesso à sua conta.</p></div><Youtube size={22} className="youtube-icon"/></div>{channels.length ? <ul className="source-list">{channels.map(source => <li key={source.id}><div className="source-avatar"><Youtube size={22}/></div><div className="source-details"><h3><a href={`https://www.youtube.com/channel/${source.channelId}`} target="_blank" rel="noopener noreferrer">{source.name}<ArrowUpRight size={14}/></a></h3><p>{source.channelId}</p><span className={`state-label ${source.enabled ? "success-text" : "muted"}`}><span className="dot"/>{source.enabled ? "Ativo" : "Pausado"}</span><LastRun run={lastRuns.get(source.id)}/></div><ActionForm action={toggleSource} className="source-toggle"><input type="hidden" name="id" value={source.id}/><SubmitButton className="icon-button" label={`${source.enabled ? "Pausar" : "Ativar"} canal ${source.name}`}>{source.enabled ? <Pause size={17}/> : <Play size={17}/>}</SubmitButton></ActionForm></li>)}</ul> : <div className="empty-state compact"><Radio size={30}/><h3>Quem você quer acompanhar?</h3><p>Adicione seu primeiro canal no formulário ao lado.</p></div>}<div className="inline-note">Pausar uma fonte oculta os itens que só ela fornece. Itens também encontrados em outra fonte ativa continuam visíveis.</div></section><section className="panel"><h2>Adicionar canal</h2><p>Até 25 canais para manter a coleta leve.</p><ActionForm action={addSource} className="stack-form"><label htmlFor="name">Nome do canal</label><input id="name" name="name" placeholder="Como você quer identificar o canal" required maxLength={120}/><label htmlFor="channel">ID ou URL do canal</label><input id="channel" name="channel" placeholder="UC… ou https://youtube.com/channel/UC…" required maxLength={500} aria-describedby="channel-help"/><p id="channel-help" className="field-help">Use o ID que começa com UC. No YouTube, ele pode ser copiado em Sobre o canal → Compartilhar canal → Copiar ID do canal. Links @handle não funcionam com o RSS.</p><SubmitButton>Adicionar canal</SubmitButton></ActionForm></section></div>
    <section className="news-sources" id="noticias"><div className="section-heading"><div><h2>Notícias externas</h2><p>RSS públicos para Fora da bolha, coletados pelo servidor. Não são seu algoritmo pessoal.</p></div></div><div className="split-layout"><div>{news.length ? <ul className="source-list">{news.map(source => <li key={source.id}><div className="source-details"><h3>{source.name}</h3><p>{source.channelId}</p><span className={`state-label ${source.enabled ? "success-text" : "muted"}`}>{source.enabled ? "RSS ativo" : "RSS pausado"}</span><LastRun run={lastRuns.get(source.id)}/></div><ActionForm action={toggleSource}><input type="hidden" name="id" value={source.id}/><SubmitButton className="icon-button" label={`${source.enabled ? "Pausar" : "Ativar"} RSS ${source.name}`}>{source.enabled ? <Pause size={17}/> : <Play size={17}/>}</SubmitButton></ActionForm></li>)}</ul> : <div className="empty-state compact"><h3>Escolha seus portais.</h3><p>Nenhum portal vem habilitado por padrão. Cadastre um RSS público em HTTPS.</p></div>}<p className="field-help">Somente títulos e trechos do feed, sem baixar o artigo completo ou mídia. Endereços privados e redirecionamentos inseguros são bloqueados.</p></div><section className="panel"><h3>Adicionar RSS externo</h3><ActionForm action={addNewsSource} className="stack-form"><label htmlFor="news-name">Nome do portal</label><input id="news-name" name="name" required maxLength={120}/><label htmlFor="news-url">URL do RSS público</label><input id="news-url" name="url" type="url" placeholder="https://seu-portal.example/rss.xml" required maxLength={2048}/><p className="field-help">Até dez feeds. Não inclua credenciais, tokens ou endereços da rede local.</p><SubmitButton>Adicionar RSS</SubmitButton></ActionForm></section></div></section>
  </>;
}
