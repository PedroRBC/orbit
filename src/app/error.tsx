"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="state-shell" tabIndex={-1}><section className="page-state" aria-labelledby="error-title">
    <h1 id="error-title">Não foi possível abrir esta página.</h1>
    <p>Tente novamente. Se o problema continuar, confira os logs do servidor.</p>
    <div className="state-actions"><button type="button" className="button" onClick={reset}>Tentar novamente</button><Link href="/" className="button secondary">Voltar ao início</Link></div>
  </section></main>;
}
