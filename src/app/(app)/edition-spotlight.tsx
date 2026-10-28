import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import type { OrbitDB } from "../../db/index";
import { editions } from "../../db/schema";
import { editionLabel, editionTime, readEditionSchedule } from "../../lib/editions";
import { WorkRefresh } from "../components";

export function EditionSpotlight({ db }: { db: OrbitDB }) {
  const latest = db.select().from(editions).orderBy(desc(editions.scheduledAt), desc(editions.id)).get();
  const published = latest?.status === "published" ? latest : db.select().from(editions).where(eq(editions.status, "published")).orderBy(desc(editions.scheduledAt), desc(editions.id)).get();
  const schedule = readEditionSchedule(db);
  const active = latest?.status === "queued" || latest?.status === "running";
  return <section className="edition-spotlight" aria-labelledby="general-briefing-title">
    <WorkRefresh active={active}/>
    <div className="section-heading"><div><h2 id="general-briefing-title">Brasil e mundo</h2><p>Briefing geral · 08h e 16h · {schedule.timezone}</p></div><Link href="/briefings" className="text-link">Arquivo de edições<ArrowRight size={16} aria-hidden="true"/></Link></div>
    {published?.content ? <>
      <p className="edition-meta">{editionLabel(published.edition)} · fechamento {editionTime(published.windowTo, published.timezone)}</p>
      {Date.now() - published.windowTo > 86400000 && <p className="warning-text">Esta é uma edição anterior, não um panorama de hoje.</p>}
      <p>{published.content.introduction}</p>
      <Link href={`/briefings/${published.id}`} className="button secondary">Ler edição<ArrowRight size={16} aria-hidden="true"/></Link>
    </> : <div className="edition-empty"><h3>{active ? "Sua edição está em preparação." : "O próximo panorama começa nas suas fontes."}</h3><p>{latest?.notice || "Cadastre RSS públicos de sua confiança e configure o modelo de briefing. Nenhum portal vem escolhido pelo Orbit."}</p><Link href="/fontes#noticias" className="text-link">Configurar fontes públicas<ArrowRight size={16} aria-hidden="true"/></Link></div>}
    {published && latest?.id !== published.id && <p className="field-help">{active ? "Uma nova edição está na fila ou em preparação. A anterior continua disponível." : latest?.notice}</p>}
    {(schedule.needsTimezone || !schedule.enabled) && <p className="field-help">{schedule.needsTimezone ? "Fuso ainda não confirmado. Proposta: America/Sao_Paulo." : "Agenda de briefings pausada."} <Link href="/configuracoes#edicoes">Revisar agenda</Link></p>}
    <p className="field-help">RSS públicos configurados, coletados no servidor. Separado do seu algoritmo pessoal; a abrangência depende das fontes.</p>
  </section>;
}
