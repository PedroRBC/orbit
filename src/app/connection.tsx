"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

// Só informa a desconexão: nada é guardado, enfileirado ou reenviado depois.
export function ConnectionStatus() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    let active = true;
    const check = async () => {
      if (!navigator.onLine) { setOffline(true); return; }
      // Qualquer resposta (inclusive 503) prova que o servidor está alcançável.
      try { await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(8000) }); if (active) setOffline(false); }
      catch { if (active) setOffline(true); }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 30_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return <div aria-live="polite">{offline && <div className="connection-banner"><WifiOff size={17} aria-hidden="true"/><span><strong>Sem conexão com o Orbit.</strong> O que está na tela pode estar desatualizado, e nada que você tocar agora será salvo.</span></div>}</div>;
}
