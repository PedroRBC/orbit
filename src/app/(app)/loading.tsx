export default function Loading() {
  return <section className="loading-state" aria-busy="true" aria-label="Carregando página">
    <p role="status" className="muted">Carregando seu conteúdo…</p>
    <div className="loading-preview" aria-hidden="true">
      <div className="loading-placeholder loading-title"/>
      <div className="loading-placeholder loading-meta"/>
      <div className="loading-lines"><div className="loading-placeholder"/><div className="loading-placeholder"/><div className="loading-placeholder"/></div>
      <div className="loading-lines"><div className="loading-placeholder"/><div className="loading-placeholder"/><div className="loading-placeholder"/></div>
    </div>
  </section>;
}
