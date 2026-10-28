"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Activity, Bookmark, BookOpen, Compass, Layers3, Menu, Monitor, Radio, Settings2, X } from "lucide-react";

const readingLinks = [
  { href: "/", label: "Hoje", icon: Compass },
  { href: "/briefings", label: "Briefings", icon: BookOpen },
  { href: "/temas", label: "Temas", icon: Layers3 },
];
const secondaryLinks = [
  { href: "/?lista=saved", label: "Salvos", icon: Bookmark },
  { href: "/fontes", label: "Fontes", icon: Radio },
  { href: "/configuracoes", label: "Configurações", icon: Settings2 },
  { href: "/status", label: "Status", icon: Activity },
  { href: "/conectar", label: "Navegador", icon: Monitor },
];

export function Navigation() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const isCurrent = (href: string) => {
    if (href.includes("?")) return false;
    const route = href.split("#")[0];
    return pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
  };

  return <div className="app-navigation" onKeyDown={event => {
    if (event.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      menuButton.current?.focus();
    }
  }}>
    <button ref={menuButton} type="button" className="navigation-menu" aria-expanded={menuOpen} aria-controls="orbit-secondary-navigation" onClick={() => setMenuOpen(!menuOpen)}>
      {menuOpen ? <X size={18} aria-hidden="true"/> : <Menu size={18} aria-hidden="true"/>}<span>Menu</span>
    </button>
    <nav className="nav-primary" aria-label="Navegação principal">
      {readingLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon size={19} aria-hidden="true"/><span>{label}</span></Link>)}
    </nav>
    <div id="orbit-secondary-navigation" className={`nav-secondary-wrap${menuOpen ? " is-open" : ""}`}>
      <p className="nav-section-label">Organizar</p>
      <nav className="nav-secondary" aria-label="Navegação secundária">
        {secondaryLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon size={18} aria-hidden="true"/><span>{label}</span></Link>)}
      </nav>
    </div>
  </div>;
}
