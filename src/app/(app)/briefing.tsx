import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../../db/index";
import { briefings, collectorRuns, rawItems, topics } from "../../db/schema";
import { aiStatus } from "../../lib/config";
import { getSetting } from "../../lib/store";
import { platformLabels } from "../../collectors/types";
import { PersonalBriefingButton, TrackedLink, WorkRefresh } from "../components";

export function DailyBriefing({ db }: { db: OrbitDB }) {
  const briefing = db.select().from(briefings).orderBy(desc(briefings.createdAt), desc(briefings.id)).get();
  const active = !!db.select().from(collectorRuns).where(sql`${collectorRuns.parentId} IS NULL AND ${collectorRuns.kind} = 'briefing' AND ${collectorRuns.status} IN ('queued', 'running')`).get();
  const status = aiStatus(db).briefing, ready = status.state === "carregado";
  const stored = getSetting(db, "briefing_notice");
  const notice = status.reason || (ready && /^(Configure AI_|AI_|Informe AI_|Configuração de briefing inválida)/.test(stored || "") ? undefined : stored);
  const noPersonal = notice?.startsWith("Nenhum item pessoal");
  if (!briefing) {
    return <section className="briefing-panel briefing-empty" aria-labelledby="briefing-title"><WorkRefresh active={active}/><div className="section-heading"><h2 id="briefing-title">Seu briefing pessoal</h2><PersonalBriefingButton/></div>{active && <p role="status">Atualizando o briefing pessoal…</p>}<p>{notice || "Modelo de briefing configurado. Atualize as fontes ou solicite o briefing para gerar seu recorte com os itens classificados."}</p>{noPersonal ? <p><Link href="/briefings" className="text-link">Ver briefings gerais</Link> · <Link href="#outside-title" className="text-link">Fora da bolha</Link></p> : <Link href={ready ? "/status" : "/configuracoes#ia"} className="text-link">{ready ? "Acompanhar geração do briefing" : "Configurar modelo de briefing"}</Link>}</section>;
  }
  const groups = db.select().from(topics).where(eq(topics.briefingId, briefing.id)).orderBy(topics.position).all().map(topic => ({ ...topic, ids: z.array(z.string()).parse(JSON.parse(topic.itemIds)) }));
  const ids = groups.flatMap(topic => topic.ids);
  const items = ids.length ? db.select().from(rawItems).where(inArray(rawItems.id, ids)).all() : [];
  const externalIds = new Set(items.filter(item => item.platform === "news").map(item => item.id));
  const externalCount = externalIds.size, personalCount = items.length - externalCount;
  const externalNotice = getSetting(db, "briefing_external_notice");
  const wordCount = `${briefing.introduction} ${groups.map(topic => topic.summary).join(" ")}`.trim().split(/\s+/).length;
  const stale = briefing.createdAt < Date.now() - 86_400_000;
  return <section className="briefing-panel" aria-labelledby="briefing-title">
    <WorkRefresh active={active}/>
    <div className="section-heading"><div><h2 id="briefing-title">Seu briefing pessoal</h2><p>{new Date(briefing.createdAt).toLocaleString("pt-BR")} · {wordCount < 180 ? "Leitura breve" : `${Math.max(1, Math.ceil(wordCount / 200))} min de leitura`} · {personalCount} {personalCount === 1 ? "item pessoal" : "itens pessoais"} · {externalCount} {externalCount === 1 ? "notícia externa" : "notícias externas"}</p></div><PersonalBriefingButton/></div>
    {active && <p className="field-help" role="status">Atualizando o briefing pessoal…</p>}
    {notice && <p className="field-help" role="status">{notice}</p>}
    <p className="briefing-disclaimer">O que seu feed está mostrando — não necessariamente o mais importante no mundo. As fontes podem trazer opiniões e alegações não verificadas.</p>
    {externalCount > 0 ? <p className="briefing-disclaimer">Inclui notícias externas de RSS como complemento; elas não vêm do seu algoritmo.</p> : externalNotice && <p className="field-help">{externalNotice}</p>}
    {stale && <p className="warning-text field-help">Este é o último briefing disponível, gerado há mais de 24 horas. Atualize as fontes para gerar um novo.</p>}
    {briefing.budgetLimited ? <p className="warning-text field-help">O orçamento reduziu a amostra: {briefing.sourceCount} de {briefing.candidateCount} itens selecionados. Este recorte fica em cache até mudar o conteúdo ou o perfil.</p> : briefing.sourceCount < 5 && <p className="field-help">Amostra pequena: briefing reduzido para não preencher lacunas com conteúdo inventado.</p>}
    <p className="briefing-introduction">{briefing.introduction}</p>
    <div className="briefing-topics">{groups.map(topic => <section key={topic.id}><h3>{topic.title}</h3>{topic.ids.some(id => externalIds.has(id)) && <span className="external-label">Inclui fonte externa</span>}<p>{topic.summary}</p><div className="briefing-sources" aria-label={`Fontes de ${topic.title}`}>{topic.ids.map(id => { const item = items.find(item => item.id === id); return item ? <TrackedLink rawId={id} key={id} href={item.url} target="_blank" rel="noopener noreferrer">{platformLabels[item.platform as keyof typeof platformLabels] || item.platform} · {item.author}</TrackedLink> : null; })}</div></section>)}</div>
    <p className="field-help">Itens pessoais coletados nas 24 horas anteriores; as publicações originais podem ser mais antigas. {externalCount > 0 && "Notícias externas usam data de publicação comprovada nas últimas 24 horas. "}Modelo: {briefing.model}.</p>
  </section>;
}
