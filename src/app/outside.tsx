import Link from "next/link";
import { Globe } from "lucide-react";
import type { OrbitDB } from "../db/index";
import { outsideItems } from "../lib/outside";
import { getProfile } from "../lib/store";
import { FeedbackControls, TrackedLink } from "./components";

export function OutsideBubble({ db }: { db: OrbitDB }) {
  const rows = outsideItems(db);
  const profile = getProfile(db);
  return <section className="outside-panel" aria-labelledby="outside-title"><div className="section-heading"><div><h2 id="outside-title">Fora da bolha</h2><p>Notícias de RSS externos. Esta seção não vem do seu algoritmo.</p></div><Globe size={22} aria-hidden="true"/></div>
    <p className="field-help">Seleção complementar por diversidade de temas e análise das manchetes. Não é checagem de fatos nem prova de que seus algoritmos omitiram o assunto.</p>
    {rows.length ? <div className="outside-list">{rows.map(({ item, analysis, source, reaction, reason }) => <article key={item.id}><div className="item-meta"><span className="external-label">Fonte externa · RSS</span><span>{source}</span><span>{analysis?.theme || "Ainda não classificado"}</span><span>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("pt-BR") : "Data não informada"}</span></div><h3><TrackedLink rawId={item.id} href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</TrackedLink></h3><p>{analysis?.summary || (item.text ? `${item.text.slice(0, 500)}${item.text.length > 500 ? "…" : ""}` : "O portal não forneceu trecho no RSS.")}</p><p className="outside-reason">{reason}</p><div className="evidence-label">{analysis ? "Resumo de IA sobre título/trecho RSS." : "Trecho original do RSS, sem análise de IA."} O artigo completo não foi baixado.</div>{analysis && profile?.interests.trim() && <FeedbackControls rawId={item.id} vote={reaction?.vote} saved={reaction?.saved} seen={reaction?.seen}/>}</article>)}</div> : <div className="empty-state compact"><h3>Amplie o seu recorte.</h3><p>Cadastre RSS públicos de notícias em Fontes. Depois da coleta e classificação, até três itens complementares aparecem aqui, sem conteúdo fictício.</p><Link href="/fontes#noticias" className="text-link">Configurar notícias externas</Link></div>}
  </section>;
}
