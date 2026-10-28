"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="empty-state"><h1>Não foi possível abrir esta página.</h1><p>Seus dados não foram apagados. Confira o terminal e tente novamente.</p><button className="button" onClick={reset}>Tentar novamente</button></section>;
}
