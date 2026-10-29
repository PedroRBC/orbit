import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { requireSession } from "../../../../lib/session";
import { getDatabase } from "../../../../db/index";
import { editions, rawItems } from "../../../../db/schema";
import { editionLabel, editionTime } from "../../../../lib/editions";
import { WorkRefresh } from "../../../components";

export const metadata = { title: "Edição do briefing" };
export default async function EditionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  await connection();
  const { id } = await params;
  if (!/^[1-9]\d{0,11}$/.test(id)) notFound();
  const db = getDatabase();
  const edition = db.select().from(editions).where(eq(editions.id, Number(id))).get();
  if (!edition) notFound();
  const items = edition.itemIds.length ? db.select().from(rawItems).where(inArray(rawItems.id, edition.itemIds)).all() : [];
  const active = edition.status === "queued" || edition.status === "running";
  const displayTime = edition.edition === "manual" ? edition.generatedAt ?? edition.scheduledAt : edition.scheduledAt;
  return <>
    <WorkRefresh active={active}/>
    <Link href="/briefings" className="text-link"><ArrowLeft size={16} aria-hidden="true"/>Todas as edições</Link>
    <header className="edition-header">
      <h1>{editionLabel(edition.edition)}</h1>
      <p className="edition-meta">{edition.edition === "manual" ? edition.generatedAt !== null ? "Gerada em" : "Solicitada em" : "Fechamento:"} <time dateTime={new Date(displayTime).toISOString()}>{editionTime(displayTime, edition.timezone)}</time> · {edition.timezone}</p>
      <p>Período coberto: {editionTime(edition.windowFrom, edition.timezone)} a {editionTime(edition.windowTo, edition.timezone)}.</p>
      {edition.edition !== "manual" && edition.generatedAt && <p className="field-help">Gerada em {editionTime(edition.generatedAt, edition.timezone)}. {edition.generatedAt - edition.scheduledAt >= 60000 && "A geração ocorreu após o fechamento; notícias posteriores não foram incluídas."}</p>}
      {Date.now() - edition.windowTo > 86400000 && <p className="warning-text">Edição de arquivo. Os fatos abaixo se referem ao período indicado, não ao momento atual.</p>}
      <p className="field-help">Briefing geral · RSS públicos configurados · separado do feed pessoal. Os trechos disponíveis não substituem a leitura dos originais.</p>
    </header>
    {edition.notice && <p className="notice" role="status">{edition.notice}</p>}
    {edition.status === "published" && edition.content ? <>
      <p className="briefing-introduction">{edition.content.introduction}</p>
      {edition.budgetLimited && <p className="warning-text">O orçamento reduziu a amostra. Nem todas as notícias elegíveis puderam ser enviadas à IA.</p>}
      <div className="edition-highlights">{edition.content.highlights.map((highlight, index) => <section key={index} className="edition-highlight">
        <h2>{highlight.title}</h2>
        <p>{highlight.summary}</p>
        <div className="edition-context"><h3>Contexto</h3><p>{highlight.context}</p><h3>Por que importa</h3><p>{highlight.relevance}</p></div>
        <div className="edition-sources" aria-label={`Fontes de ${highlight.title}`}><h3>Nas fontes</h3>{highlight.itemIds.map(itemId => {
          const item = items.find(item => item.id === itemId);
          return item ? <p key={itemId}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<ArrowUpRight size={14} aria-hidden="true"/></a><span className="field-help">{item.author} · {item.newsPublishedAt ? editionTime(item.newsPublishedAt, edition.timezone) : "Data de publicação não confirmada"}</span></p> : <p key={itemId}>Fonte original indisponível neste banco.</p>;
        })}</div>
      </section>)}</div>
      <p className="field-help">Gerado pelo modelo configurado ({edition.model}). Pode conter erros de síntese: confira as fontes. Não houve consulta à reportagem integral.</p>
    </> : <section className="edition-empty"><h2>{active ? "Edição em preparação" : "Esta edição não foi publicada"}</h2><p>{active ? "O worker coleta as fontes públicas e prepara o briefing. Esta página será atualizada automaticamente." : "Nenhum resumo foi inventado para preencher a edição. Revise as fontes, o modelo e o orçamento antes do próximo horário."}</p><Link href={active ? "/status" : "/configuracoes#edicoes"} className="text-link">{active ? "Ver andamento" : "Revisar configuração"}</Link></section>}
  </>;
}
