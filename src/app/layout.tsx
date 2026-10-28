import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Orbit — seu conteúdo, com contexto", template: "%s · Orbit" }, description: "Seu curador pessoal de conteúdo. Transparente e no seu ritmo.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><a className="skip-link" href="#main">Pular para o conteúdo</a>{children}</body></html>;
}
