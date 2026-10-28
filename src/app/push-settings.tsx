"use client";

import { useEffect, useState, useTransition } from "react";
import { getPushConfiguration, subscribePush, testPush, unsubscribePush } from "./push-actions";
import type { PushConfiguration } from "../lib/push";
import type { ActionResult } from "./actions";

function applicationKey(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export function PushSettings({ editionId = null }: { editionId?: number | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [configuration, setConfiguration] = useState<PushConfiguration | null>(null);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [result, setResult] = useState<ActionResult>({ message: "" });
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const available = window.isSecureContext && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
    setSupported(available);
    if (!available) return;
    setPermission(Notification.permission);
    let active = true;
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        const state = await getPushConfiguration(subscription?.endpoint ?? null);
        if (active) { setBrowserSubscribed(!!subscription); setConfiguration(state); }
      } catch { if (active) setResult({ error: true, message: "Não foi possível consultar as notificações. Recarregue a página para tentar novamente." }); }
    });
    return () => { active = false; };
  }, []);
  function enable() {
    if (!configuration?.publicKey) return;
    // A permissão é pedida diretamente no clique, antes de qualquer ida ao servidor.
    let requested: Promise<NotificationPermission>;
    try { requested = Notification.requestPermission(); }
    catch { setResult({ error: true, message: "O navegador não permitiu solicitar notificações. Verifique as configurações deste site." }); return; }
    startTransition(async () => {
      let created: PushSubscription | null = null;
      try {
        const granted = await requested; setPermission(granted);
        if (granted !== "granted") { setResult({ error: true, message: "Permissão não concedida. Você pode alterá-la nas configurações do navegador." }); return; }
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) setBrowserSubscribed(true);
        const key = applicationKey(configuration.publicKey!);
        if (subscription?.options.applicationServerKey) {
          const existing = new Uint8Array(subscription.options.applicationServerKey);
          if (existing.length !== key.length || !existing.every((byte, index) => byte === key[index])) {
            setResult({ error: true, message: "A chave deste aparelho mudou. Desative as notificações aqui e ative novamente." }); return;
          }
        }
        if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); created = subscription; }
        setBrowserSubscribed(true);
        const saved = await subscribePush(JSON.stringify(subscription.toJSON()));
        if (saved.error) {
          if (created) { const removed = await created.unsubscribe(); setBrowserSubscribed(!removed); }
          setResult(saved); return;
        }
        setConfiguration({ ...configuration, subscribed: true }); setResult(saved);
      } catch {
        if (created) { try { const removed = await created.unsubscribe(); setBrowserSubscribed(!removed); } catch { /* A ação de desativar continua disponível. */ } }
        setResult({ error: true, message: "Não foi possível ativar. Confira a conexão, a permissão do navegador e tente novamente." });
      }
    });
  }
  function disable() {
    startTransition(async () => {
      try {
        const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        if (!subscription) { setBrowserSubscribed(false); setConfiguration(current => current ? { ...current, subscribed: false } : current); setResult({ message: "Este navegador não tem inscrição ativa." }); return; }
        const saved = await unsubscribePush(subscription.endpoint); setResult(saved);
        if (saved.error) return;
        setConfiguration(current => current ? { ...current, subscribed: false } : current);
        try {
          const removed = await subscription.unsubscribe(); setBrowserSubscribed(!removed);
          if (!removed) setResult({ error: true, message: "Desativadas no Orbit. A inscrição local não foi removida; tente desativar novamente." });
        } catch { setResult({ error: true, message: "Desativadas no Orbit. Remova também a permissão nas configurações do navegador." }); }
      } catch { setResult({ error: true, message: "Não foi possível desativar. Confira a conexão e tente novamente." }); }
    });
  }
  function test() {
    startTransition(async () => {
      try {
        const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        setResult(subscription ? await testPush(subscription.endpoint, editionId) : { error: true, message: "Ative as notificações neste aparelho antes de testar." });
      } catch { setResult({ error: true, message: "Não foi possível enfileirar o teste. Confira a conexão e tente novamente." }); }
    });
  }
  return <section className="panel" aria-labelledby="push-heading" aria-busy={pending}>
    <h2 id="push-heading">Notificações de edições</h2>
    <p>Receba um aviso discreto quando uma edição estiver pronta, mesmo com o Orbit fechado. Ative separadamente em cada aparelho.</p>
    {supported === null && <p role="status">Verificando suporte a notificações…</p>}
    {supported === false && <p>Este navegador não oferece Web Push aqui. Use HTTPS e um navegador compatível. No iPhone/iPad, adicione o Orbit à Tela de Início e abra por esse ícone (iOS/iPadOS 16.4 ou posterior).</p>}
    {supported && <>
      <p>{configuration?.message ?? "Consultando configuração do servidor…"}</p>
      <p>Estado neste aparelho: <strong>{configuration?.subscribed ? "ativadas" : "desativadas"}</strong>.</p>
      {permission === "denied" && <p className="error-text">Notificações bloqueadas no navegador. Altere a permissão do Orbit nas configurações e recarregue esta página para ativar.</p>}
      <div className="access-actions">
        {!configuration?.subscribed && <button type="button" className="button" disabled={pending || !configuration?.publicKey || permission === "denied"} onClick={enable}>Ativar neste aparelho</button>}
        {browserSubscribed && <button type="button" className="button secondary" disabled={pending} onClick={disable}>Desativar neste aparelho</button>}
        <button type="button" className="button secondary" disabled={pending || !configuration?.subscribed || !configuration.publicKey || permission !== "granted"} onClick={test}>Testar notificação</button>
      </div>
      {editionId === null && <p className="field-help">Você já pode testar. Sem uma edição pronta, o aviso abre o arquivo de briefings.</p>}
      <p className="field-help">O servidor e o worker precisam estar ligados e com acesso à internet. O sistema pode adiar ou bloquear a entrega; navegador encerrado à força ou restrições de bateria podem impedir o aviso.</p>
    </>}
    {result.message && <p className={result.error ? "form-message error-text" : "form-message success-text"} role={result.error ? "alert" : "status"}>{result.message}</p>}
  </section>;
}
