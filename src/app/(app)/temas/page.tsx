import Link from "next/link";
import { connection } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { requireSession } from "../../../lib/session";
import { getDatabase } from "../../../db/index";
import { processedItems, rawItems } from "../../../db/schema";
import { activeItemCondition } from "../../../lib/store";
import { listThemes, MAX_THEMES } from "../../../lib/taxonomy";
import { pendingProposalGroups } from "../../../lib/themes";
import { mergeThemeAction } from "../../actions";
import { ActionForm, SubmitButton } from "../../components";

export const metadata = { title: "Temas" };
export default async function ThemesPage() {
  await requireSession();
  await connection();
  const db = getDatabase();
  const themes = listThemes(db);
  const pending = pendingProposalGroups(db);
  const counts = db.select({ theme: processedItems.theme, total: sql<number>`count(*)` }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(activeItemCondition(), ne(rawItems.platform, "news"), eq(processedItems.isSpam, false))).groupBy(processedItems.theme).all();
  return <>
    <div className="page-heading"><div><h1>Temas</h1><p>Temas base do Orbit e temas criados automaticamente quando um assunto se repete nos seus conteúdos.</p></div></div>
    {themes.length >= MAX_THEMES && <p className="notice" role="status">Limite de 40 temas atingido; junte temas para liberar espaço.</p>}
    <div className="edition-list">{themes.map(theme => {
      const total = counts.find(count => count.theme === theme.id)?.total || 0;
      return <section key={theme.id} data-origin={theme.origin}><h2><Link className="edition-link" href={`/?tema=${theme.id}&periodo=all#recommendations`}>{theme.label}<ArrowRight size={18} aria-hidden="true"/></Link></h2>{theme.origin === "seed" ? <p>{theme.description}</p> : <p className="field-help">Criado automaticamente em {new Date(theme.createdAt).toLocaleDateString("pt-BR")}</p>}<p className="field-help">{total ? `${total} ${total === 1 ? "item pessoal disponível" : "itens pessoais disponíveis"}` : "Ainda sem itens pessoais classificados neste tema."}</p>
        {theme.origin === "ai" && <ActionForm action={mergeThemeAction} className="stack-form"><input type="hidden" name="from" value={theme.id}/><label htmlFor={`merge-${theme.id}`}>Juntar a outro tema</label><select id={`merge-${theme.id}`} name="into" required defaultValue="outros">{themes.filter(other => other.id !== theme.id).map(other => <option key={other.id} value={other.id}>{other.label}</option>)}</select><SubmitButton className="button secondary">Juntar</SubmitButton></ActionForm>}
      </section>;
    })}</div>
    <section className="panel" aria-labelledby="pending-themes"><h2 id="pending-themes">Em observação</h2>{pending.length ? <ul>{pending.map(group => <li key={group.label}>{group.label} · {group.count} de 3 itens</li>)}</ul> : <p>Ainda não há temas em observação.</p>}</section>
    <p className="field-help">Estes são temas de classificação, não manchetes ou acontecimentos individuais. Os <Link href="/briefings">briefings gerais</Link> usam RSS públicos separados. Para ajustar suas preferências e pesos, abra <Link href="/perfil#temas">Meu perfil</Link>.</p>
  </>;
}
