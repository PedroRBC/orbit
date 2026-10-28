"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="login-shell"><section className="empty-state"><h1>Não foi possível abrir esta página.</h1><p>Seus dados não foram apagados. Confira os logs do servidor e tente novamente.</p><button className="button" onClick={reset}>Tentar novamente</button></section></main>;
}
