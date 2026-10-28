import Link from "next/link";
export default function NotFound() { return <section className="empty-state"><h1>Este caminho saiu de órbita.</h1><p>A página não existe. Seu conteúdo continua no início.</p><Link href="/" className="button">Voltar ao início</Link></section>; }
