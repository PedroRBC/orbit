import type { Metadata } from "next";
import Link from "next/link";
import { Orbit, LockKeyhole } from "lucide-react";
import { Navigation } from "./components";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Orbit — seu conteúdo, com contexto", template: "%s · Orbit" }, description: "Seu curador pessoal de conteúdo. Local, transparente e no seu ritmo.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><a className="skip-link" href="#main">Pular para o conteúdo</a><div className="app-shell"><aside className="sidebar"><Link href="/" className="brand" aria-label="Orbit, início"><Orbit size={30} strokeWidth={1.5} aria-hidden="true"/>orbit<span className="version">pessoal</span></Link><Navigation/><div className="sidebar-foot"><LockKeyhole size={15} aria-hidden="true"/><span>Seu espaço local<br/><small>Dados no seu computador</small></span></div></aside><div className="workspace"><header className="topbar"><span>Menos ruído. Mais contexto.</span><span className="local-badge"><span className="dot"/>Uso pessoal</span></header><main id="main">{children}</main><footer className="footer">Seu feed é um recorte do mundo, não o mundo inteiro.<span>Orbit · Curadoria pessoal</span></footer></div></div></body></html>;
}
