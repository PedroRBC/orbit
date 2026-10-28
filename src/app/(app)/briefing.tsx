import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { OrbitDB } from "../../db/index";
import { briefings, rawItems, topics } from "../../db/schema";
import { aiStatus } from "../../lib/config";
import { getSetting } from "../../lib/store";
import { platformLabels } from "../../collectors/types";
import { TrackedLink } from "../components";

export function DailyBriefing({ db }: { db: OrbitDB }) {
  const briefing = db.select().from(briefings).orderBy(desc(briefings.createdAt), desc(briefings.id)).get();
  if (!briefing) {
    const ready = aiStatus().briefingReady;
    const stored = getSetting(db, "briefing_notice");
    const notice = ready && /^Configure AI_BRIEFING_MODEL/.test(stored || "") ? undefined : stored;
    return <section className="briefing-panel briefing-empty" aria-labelledby="briefing-title"><h2 id="briefing-title">Briefing do dia</h2><p>{notice || (ready ? "Modelo de briefing configurado. Atualize as fontes para gerar seu recorte com os itens classificados." : "Depois de conectar o modelo de briefing e atualizar as fontes, seu recorte do dia aparece aqui.")}</p><Link href={ready ? "/status" : "/configuracoes#ia"} className="text-link">{ready ? "Acompanhar geração do briefing" : "Configurar modelo de briefing"}</Link></section>;
  }
  const groups = db.select().from(topics).where(eq(topics.briefingId, briefing.id)).orderBy(topics.position).all().map(topic => ({ ...topic, ids: z.array(z.string()).parse(JSON.parse(topic.itemIds)) }));
  const ids = groups.flatMap(topic => topic.ids);
  const items = ids.length ? db.select().from(rawItems).where(inArray(rawItems.id, ids)).all() : [];
  const wordCount = `${briefing.introduction} ${groups.map(topic => topic.summary).join(" ")}`.trim().split(/\s+/).length;
  const stale = briefing.createdAt < Date.now() - 86_400_000;
  return <section className="briefing-panel" aria-labelledby="briefing-title">
    <div className="section-heading"><div><h2 id="briefing-title">Briefing do dia</h2><p>{new Date(briefing.createdAt).toLocaleString("pt-BR")} · {wordCount < 180 ? "Leitura breve" : `${Math.max(1, Math.ceil(wordCount / 200))} min de leitura`}</p></div><span className="count-label">{briefing.sourceCount} itens na amostra</span></div>
    <p className="briefing-disclaimer">O que seu feed está mostrando — não necessariamente o mais importante no mundo. As fontes podem trazer opiniões e alegações não verificadas.</p>
    {stale && <p className="warning-text field-help">Este é o último briefing disponível, gerado há mais de 24 horas. Atualize as fontes para gerar um novo.</p>}
    {briefing.budgetLimited ? <p className="warning-text field-help">O orçamento reduziu a amostra: {briefing.sourceCount} de {briefing.candidateCount} itens selecionados. Este recorte fica em cache até mudar o conteúdo, o perfil ou o dia UTC.</p> : briefing.sourceCount < 5 && <p className="field-help">Amostra pequena: briefing reduzido para não preencher lacunas com conteúdo inventado.</p>}
    <p className="briefing-introduction">{briefing.introduction}</p>
    <div className="briefing-topics">{groups.map(topic => <section key={topic.id}><h3>{topic.title}</h3><p>{topic.summary}</p><div className="briefing-sources" aria-label={`Fontes de ${topic.title}`}>{topic.ids.map(id => { const item = items.find(item => item.id === id); return item ? <TrackedLink rawId={id} key={id} href={item.url} target="_blank" rel="noopener noreferrer">{platformLabels[item.platform as keyof typeof platformLabels] || item.platform} · {item.author}</TrackedLink> : null; })}</div></section>)}</div>
    <p className="field-help">Gerado a partir de itens coletados nas 24 horas anteriores. As publicações originais podem ser mais antigas. Modelo: {briefing.model}.</p>
  </section>;
}
