import Link from "next/link";
import { Orbit, LockKeyhole, UserRound } from "lucide-react";
import { Navigation } from "../navigation";
import { requireSession } from "../../lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="Orbit, início"><Orbit size={30} strokeWidth={1.5} aria-hidden="true"/>orbit</Link>
      <Navigation/>
      <div className="sidebar-foot"><LockKeyhole size={15} aria-hidden="true"/><span>Serviço pessoal<br/><small>No seu servidor</small></span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span className="masthead-title">Leitura e contexto</span><Link href="/perfil" className="masthead-profile"><UserRound size={17} aria-hidden="true"/>Meu perfil</Link></header>
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="footer"><span>Seu feed é um recorte do mundo, não o mundo inteiro.</span><span>Orbit · Curadoria pessoal</span></footer>
    </div>
  </div>;
}
