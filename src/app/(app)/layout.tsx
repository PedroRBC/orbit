import Link from "next/link";
import { Orbit, LockKeyhole } from "lucide-react";
import { Navigation } from "../components";
import { requireSession } from "../../lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <div className="app-shell"><aside className="sidebar"><Link href="/" className="brand" aria-label="Orbit, início"><Orbit size={30} strokeWidth={1.5} aria-hidden="true"/>orbit<span className="version">pessoal</span></Link><Navigation/><div className="sidebar-foot"><LockKeyhole size={15} aria-hidden="true"/><span>Seu serviço pessoal<br/><small>Dados no seu servidor</small></span></div></aside><div className="workspace"><header className="topbar"><span>Menos ruído. Mais contexto.</span><span className="local-badge"><span className="dot"/>Uso pessoal</span></header><main id="main">{children}</main><footer className="footer">Seu feed é um recorte do mundo, não o mundo inteiro.<span>Orbit · Curadoria pessoal</span></footer></div></div>;
}
