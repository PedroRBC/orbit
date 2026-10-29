import Link from "next/link";
import { connection } from "next/server";
import { desc, lt } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { requireSession } from "../../../lib/session";
import { getDatabase } from "../../../db/index";
import { editions } from "../../../db/schema";
import { editionLabel, editionTime, readEditionSchedule } from "../../../lib/editions";
import { GeneralBriefingButton, WorkRefresh } from "../../components";

export const metadata = { title: "Briefings gerais" };
export default async function EditionsPage({ searchParams }: { searchParams: Promise<{ antes?: string }> }) {
  await requireSession();
  await connection();
  const db = getDatabase();
  const { antes } = await searchParams;
  const cursor = antes && /^\d{1,12}$/.test(antes) ? Number(antes) : undefined;
  const rows = db.select().from(editions).where(cursor ? lt(editions.id, cursor) : undefined).orderBy(desc(editions.id)).limit(30).all();
  const schedule = readEditionSchedule(db);
  return <>
    <WorkRefresh active={rows.some(row => row.status === "queued" || row.status === "running")}/>
    <div className="page-heading"><div><h1>Briefings gerais</h1><p>Brasil e mundo, a partir das fontes públicas que você escolheu.</p></div><GeneralBriefingButton/></div>
    <div className="edition-header"><p>Dois fechamentos por dia: <strong>08h e 16h</strong> · {schedule.timezone}</p><p className="field-help">{schedule.needsTimezone ? "Proposta de fuso: America/Sao_Paulo. Confirme nas configurações para ativar." : schedule.enabled ? "A manhã traz o panorama; a tarde prioriza novidades desde 08h." : "Agenda pausada. O arquivo foi preservado."} <Link href="/configuracoes#edicoes">Configurar agenda e notificações</Link></p></div>
    {rows.length ? <div className="edition-list">{rows.map(row => <section key={row.id}>
      <h2><Link href={`/briefings/${row.id}`} className="edition-link">{editionLabel(row.edition)}<ArrowRight size={20} aria-hidden="true"/></Link></h2>
      <p className="edition-meta"><time dateTime={new Date(row.scheduledAt).toISOString()}>{editionTime(row.scheduledAt, row.timezone)}</time> · {row.timezone} · {row.status === "published" ? "Publicada" : row.status === "queued" ? "Na fila" : row.status === "running" ? "Em preparação" : "Não publicada"}</p>
      <p>{row.content?.introduction || row.notice || "O worker prepara esta edição sem depender da extensão."}</p>
    </section>)}</div> : <section className="edition-empty"><h2>Nenhuma edição neste arquivo.</h2><p>Adicione RSS públicos, configure o modelo de briefing e confirme o fuso. Os fechamentos são às 08h e 16h.</p><Link href="/fontes#noticias" className="button secondary">Configurar fontes públicas</Link></section>}
    <div className="access-actions">{rows.length === 30 && <Link href={`/briefings?antes=${rows.at(-1)!.id}`} className="button secondary">Edições anteriores</Link>}{cursor && <Link href="/briefings" className="text-link">Voltar às mais recentes</Link>}</div>
    <p className="field-help">Estes briefings não usam suas recomendações pessoais. A cobertura se limita aos RSS configurados, sem garantia de cobrir todo o noticiário.</p>
  </>;
}
