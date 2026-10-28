import type { Metadata, Viewport } from "next";
import { ConnectionStatus } from "./connection";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Orbit — seu conteúdo, com contexto", template: "%s · Orbit" }, applicationName: "Orbit", description: "Seu curador pessoal de conteúdo. Transparente e no seu ritmo.", robots: { index: false, follow: false }, appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "black" } };
export const viewport: Viewport = { themeColor: "#101521", colorScheme: "dark" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><a className="skip-link" href="#main">Pular para o conteúdo</a><ConnectionStatus/>{children}</body></html>;
}
