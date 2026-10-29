import Link from "next/link";
import { requireSession } from "../../lib/session";
import { connection } from "next/server";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { ArrowRight, Check, Play, SlidersHorizontal, Sparkles, Radio, MessageSquare } from "lucide-react";
import { getDatabase } from "../../db/index";
import { collectorRuns, feedback, processedItems, rawItems, sources } from "../../db/schema";
import { platformLabels } from "../../collectors/types";
import { adjustedScore, learnedWeights, rankingExpression } from "../../lib/feedback";
import { OutsideBubble } from "./outside";
import { DailyBriefing } from "./briefing";
import { EditionSpotlight } from "./edition-spotlight";
import { themeLabels } from "../../lib/taxonomy";
import { activeItemCondition, getProfile } from "../../lib/store";
import { aiStatus } from "../../lib/config";
import { CollectButton, FeedbackControls, TrackedLink, WorkRefresh, ExternalMark } from "../components";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  await connection();
  const db = getDatabase();
  const profile = getProfile(db);
  const channels = db.select().from(sources).all();
  const ai = aiStatus();
  const query = await searchParams;
  const labels = themeLabels(db);
  const theme = typeof query.tema === "string" && labels.has(query.tema) ? query.tema : "";
  const period = typeof query.periodo === "string" && ["1", "7", "30", "all"].includes(query.periodo) ? query.periodo : "7";
  const weights = learnedWeights(db);
  const list = typeof query.lista === "string" && ["all", "saved", "seen", "unseen"].includes(query.lista) ? query.lista : "all";
  const platform = typeof query.plataforma === "string" && ["youtube", "x", "instagram", "valete"].includes(query.plataforma) ? query.plataforma : "all";
  const conditions = [eq(processedItems.isSpam, false), ne(rawItems.platform, "news"), activeItemCondition()];
  if (platform !== "all") conditions.push(eq(rawItems.platform, platform));
  if (list === "saved") conditions.push(eq(feedback.saved, true));
  if (list === "seen") conditions.push(eq(feedback.seen, true));
  if (list === "unseen") conditions.push(sql`coalesce(${feedback.seen}, 0) = 0`);
  if (theme) conditions.push(eq(processedItems.theme, theme));
  if (period !== "all") conditions.push(gte(sql<number>`coalesce(${rawItems.publishedAt}, ${rawItems.fetchedAt})`, Date.now() - Number(period) * 86_400_000));
  const items = db.select({ item: rawItems, analysis: processedItems, reaction: feedback }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).leftJoin(feedback, eq(feedback.rawId, rawItems.id)).where(and(...conditions)).orderBy(desc(rankingExpression(weights)), desc(rawItems.publishedAt)).limit(100).all();
  const pending = db.select({ count: sql<number>`count(*)` }).from(rawItems).leftJoin(processedItems, eq(rawItems.id, processedItems.rawId)).where(and(sql`${processedItems.rawId} IS NULL`, ne(rawItems.platform, "news"))).get()?.count ?? 0;
  const running = db.select().from(collectorRuns).where(sql`${collectorRuns.parentId} IS NULL AND ${collectorRuns.status} IN ('queued', 'running')`).get();
  const personalSourceCount = channels.filter(source => source.kind !== "news_rss").length;
  const initial = !profile?.interests.trim() || !personalSourceCount;
  return <><WorkRefresh active={!!running}/><div className="page-heading"><div><h1>Seu dia em perspectiva.</h1><p>O noticiário e o seu universo de conteúdo, cada um no seu lugar.</p></div>{channels.length > 0 && <CollectButton/>}</div>
    <EditionSpotlight db={db}/>
    {initial ? <section className="onboarding"><div className="onboarding-intro"><div className="feature-symbol"><CompassIllustration/></div><h2>Seu próximo bom conteúdo começa aqui.</h2><p>Escolha seus interesses e os canais que quer acompanhar. O Orbit cuida de organizar o que merece sua atenção.</p><span className="quiet-label">Sem conteúdo de exemplo. Este espaço é seu.</span></div><div className="setup-list"><div className="setup-step"><div className={`step-indicator ${profile ? "done" : ""}`}>{profile ? <Check size={15} role="img" aria-label="Concluído"/> : "1"}</div><div><h3>Conte o que te interessa</h3><p>Seus temas favoritos e o que prefere deixar de fora.</p><Link href="/configuracoes" className="text-link">{profile ? "Editar interesses" : "Configurar interesses"}<ArrowRight size={16}/></Link></div></div><div className="setup-step"><div className={`step-indicator ${personalSourceCount ? "done" : ""}`}>{personalSourceCount ? <Check size={15} role="img" aria-label="Concluído"/> : "2"}</div><div><h3>Traga suas fontes</h3><p>Adicione os canais do YouTube que você acompanha.</p><Link href="/fontes" className="text-link">Adicionar canais<ArrowRight size={16}/></Link></div></div><div className="setup-step"><div className={`step-indicator ${ai.ready ? "done" : ""}`}>{ai.ready ? <Check size={15} role="img" aria-label="Concluído"/> : "3"}</div><div><h3>Conecte sua IA</h3><p>Use uma API compatível com OpenAI ou Anthropic.</p><Link href="/configuracoes#ia" className="text-link">Ver configuração<ArrowRight size={16}/></Link></div></div></div></section> : <>
      {!ai.ready && <div className="notice"><Sparkles size={18}/><div><strong>{ai.state === "invalid" ? "A configuração da IA precisa de ajuste." : "Falta conectar sua IA."}</strong><p>{ai.state === "invalid" ? ai.message : "Você já pode coletar os vídeos. A análise começa depois de configurar URL, chave e modelo no servidor (.env ou orbit.env)."}</p><Link href="/configuracoes#ia">Ver instruções</Link></div></div>}
      <DailyBriefing db={db}/>
      <section aria-labelledby="recommendations"><div className="section-heading"><div><h2 id="recommendations">Vale a pena ver</h2><p>Ordenado por relevância para seus interesses.</p></div><span className="count-label">{items.length} {items.length === 1 ? "recomendação" : "recomendações"}</span></div>
      <form method="get" className="filters"><SlidersHorizontal size={17} aria-hidden="true"/><label>Plataforma<select name="plataforma" defaultValue={platform}><option value="all">Todas</option><option value="youtube">YouTube</option><option value="x">X</option><option value="instagram">Instagram</option><option value="valete">Valete+</option></select></label><label>Tema<select name="tema" defaultValue={theme}><option value="">Todos os temas</option>{[...labels].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Período<select name="periodo" defaultValue={period}><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="all">Todo o período</option></select></label><label>Lista<select name="lista" defaultValue={list}><option value="all">Todos os itens</option><option value="saved">Salvos para depois</option><option value="seen">Já vistos</option><option value="unseen">Ainda não vistos</option></select></label><button className="button secondary" type="submit">Filtrar</button></form>
      {items.length ? <div className="recommendation-list">{items.map(({ item, analysis, reaction }) => <article className="recommendation" key={item.id}><TrackedLink rawId={item.id} className="thumbnail" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.platform === "youtube" ? "Assistir" : "Abrir post"} ${item.title}`}>{item.thumbnail ? <img src={item.thumbnail} alt="" width={320} height={180} loading="lazy" referrerPolicy="no-referrer"/> : item.platform === "youtube" ? <Play size={26}/> : <MessageSquare size={26}/>}<span className="platform-mark">{platformLabels[item.platform as keyof typeof platformLabels] || item.platform}</span></TrackedLink><div className="recommendation-content"><div className="item-meta"><span>{item.author}</span><span>·</span><span>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("pt-BR") : "Data não informada"}</span><span className="topic-tag">{labels.get(analysis.theme)}</span>{item.platform === "x" && item.metrics?.likes && <span>{item.metrics.likes} curtidas na fonte</span>}</div><h3><TrackedLink rawId={item.id} href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<ExternalMark/></TrackedLink></h3><p className="item-summary">{analysis.summary}</p><div className="recommendation-reason"><span className="score">{adjustedScore(analysis.score, Object.hasOwn(weights, analysis.theme) ? weights[analysis.theme] : 0)}/100</span><p>{analysis.reason}</p></div><div className="evidence-label">{item.platform === "instagram" ? "Legenda e metadados reconhecidos no feed" : item.platform === "valete" ? (item.evidence === "valete_dom" ? "Texto já visível no feed Valete+" : "Trecho de texto do feed Valete+") : item.platform === "x" ? "Baseado no texto visível do post" : item.evidence === "youtube_home" ? "Metadados visíveis na home, sem transcrição" : "Título e descrição RSS"} · {item.platform !== "youtube" ? "Leitura de post" : item.durationSeconds ? `${Math.ceil(item.durationSeconds / 60)} min de vídeo` : "Duração não disponível"}{Object.hasOwn(weights, analysis.theme) && weights[analysis.theme] ? " · Nota ajustada pelo seu perfil" : ""}</div><FeedbackControls rawId={item.id} vote={reaction?.vote} saved={reaction?.saved} seen={reaction?.seen}/></div></article>)}</div> : <div className="empty-state"><Radio size={30} strokeWidth={1.5}/><h3>{pending ? "Seus itens aguardam análise." : "Ainda não há recomendações neste recorte."}</h3><p>{pending ? `${pending} item(ns) coletado(s). Configure a IA e solicite uma atualização para analisar os pendentes.` : "Atualize suas fontes ou amplie os filtros. Nada será inventado para preencher seu feed."}</p><Link href="/status" className="text-link">Acompanhar status<ArrowRight size={16}/></Link></div>}
      </section></>}
    <OutsideBubble db={db}/>
    <div className="phase-note"><Sparkles size={17}/><p>Seu contexto pessoal e as fontes externas permanecem separados. Confira os originais antes de tirar conclusões.</p></div></>;
}
function CompassIllustration() { return <Sparkles size={28} strokeWidth={1.5} aria-hidden="true"/>; }
