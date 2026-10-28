import Link from "next/link";

export default function NotFound() {
  return <main id="main" className="state-shell" tabIndex={-1}><section className="page-state" aria-labelledby="not-found-title">
    <h1 id="not-found-title">Página não encontrada.</h1>
    <p>Este endereço não existe. Volte ao início para continuar sua leitura.</p>
    <div className="state-actions"><Link href="/" className="button">Voltar ao início</Link></div>
  </section></main>;
}
