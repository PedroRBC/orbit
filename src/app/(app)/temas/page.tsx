import Link from "next/link";
import { connection } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { requireSession } from "../../../lib/session";
import { getDatabase } from "../../../db/index";
import { processedItems, rawItems } from "../../../db/schema";
import { activeItemCondition } from "../../../lib/store";
import { TAXONOMY } from "../../../lib/taxonomy";

export const metadata = { title: "Temas" };
export default async function ThemesPage() {
  await requireSession();
  await connection();
  const db = getDatabase();
  const counts = db.select({ theme: processedItems.theme, total: sql<number>`count(*)` }).from(processedItems).innerJoin(rawItems, eq(processedItems.rawId, rawItems.id)).where(and(activeItemCondition(), ne(rawItems.platform, "news"), eq(processedItems.isSpam, false))).groupBy(processedItems.theme).all();
  return <>
    <div className="page-heading"><div><h1>Temas</h1><p>Um mapa simples para explorar o seu conteúdo, sem um tema novo a cada notícia.</p></div></div>
    <div className="edition-list">{TAXONOMY.map(theme => {
      const total = counts.find(count => count.theme === theme.id)?.total || 0;
      return <section key={theme.id}><h2><Link className="edition-link" href={`/?tema=${theme.id}&periodo=all#recommendations`}>{theme.label}<ArrowRight size={18} aria-hidden="true"/></Link></h2><p>{theme.description}</p><p className="field-help">{total ? `${total} ${total === 1 ? "item pessoal disponível" : "itens pessoais disponíveis"}` : "Ainda sem itens pessoais classificados neste tema."}</p></section>;
    })}</div>
    <p className="field-help">Estes são temas de classificação, não manchetes ou acontecimentos individuais. Os <Link href="/briefings">briefings gerais</Link> usam RSS públicos separados. Para ajustar suas preferências e pesos, abra <Link href="/perfil#temas">Meu perfil</Link>.</p>
  </>;
}
