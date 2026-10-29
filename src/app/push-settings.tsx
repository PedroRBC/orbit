"use client";

import { useEffect, useRef, useState } from "react";
import { getPushConfiguration, subscribePush, testPush, unsubscribePush } from "./push-actions";
import type { PushConfiguration } from "../lib/push";
import type { ActionResult } from "./actions";

function applicationKey(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
function within<T>(promise: Promise<T>, ms = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("prazo", "TimeoutError")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
function failure(error: unknown): ActionResult {
  const name = error instanceof Error ? error.name : "Error";
  const message = name === "TimeoutError"
    ? "O navegador não respondeu em 30 segundos. Ele pode estar bloqueando o serviço de notificações. Recarregue a página ou use outro navegador."
    : name === "AbortError"
      ? "O navegador não conseguiu se registrar no serviço de notificações. Navegadores sem serviços do Google, como Helium e ungoogled-chromium, geralmente não recebem notificações web; use Chrome, Firefox, Safari ou o celular."
      : name === "NotAllowedError"
        ? "Permissão não concedida. Você pode alterá-la nas configurações do navegador."
        : "Não foi possível ativar (" + name + "). Tente novamente.";
  return { error: true, message };
}
export function PushSettings({ editionId = null }: { editionId?: number | null }) {
  const [supportProblem, setSupportProblem] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<PushConfiguration | null>(null);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [result, setResult] = useState<ActionResult>({ message: "" });
  const [pending, setPending] = useState(false);
  const operating = useRef(false);
  const subscribing = useRef<boolean>(false);
  const active = useRef(false);
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  async function perform(operation: () => Promise<void>) {
    if (operating.current) return;
    operating.current = true; setPending(true);
    // useTransition continuaria ocupado pela Server Action mesmo depois do prazo local.
    try { await operation(); }
    finally { operating.current = false; if (active.current) setPending(false); }
  }
  async function refresh() {
    const registration = await within(navigator.serviceWorker.getRegistration("/"));
    const subscription = registration ? await within(registration.pushManager.getSubscription()) : null;
    const state = await within(getPushConfiguration(subscription?.endpoint ?? null));
    if (active.current) { setBrowserSubscribed(!!subscription); setConfiguration(state); }
  }
  useEffect(() => {
    active.current = true;
    const problem = !window.isSecureContext ? "Abra o Orbit por HTTPS."
      : !("serviceWorker" in navigator) ? "Este navegador não permite service workers neste site."
        : !("PushManager" in window) || !("Notification" in window)
          ? "Este navegador não oferece Web Push aqui. No iPhone/iPad, adicione o Orbit à Tela de Início e abra por esse ícone (iOS/iPadOS 16.4 ou posterior)."
          : "";
    setSupportProblem(problem);
    if (!problem) {
      setPermission(Notification.permission);
      void perform(async () => {
        try { await refresh(); }
        catch (error) { if (active.current) setResult(failure(error)); }
      });
    }
    return () => { active.current = false; refreshTimers.current.forEach(clearTimeout); };
  }, []);
  async function subscribe(registration: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) {
    if (subscribing.current) throw new DOMException("prazo", "TimeoutError");
    const request = registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    subscribing.current = true;
    // O prazo não cancela subscribe: a trava só termina quando a promessa nativa termina.
    request.then(() => {
      subscribing.current = false;
      if (active.current) setBrowserSubscribed(true);
    }, () => { subscribing.current = false; });
    return within(request);
  }
  async function replace(subscription: PushSubscription) {
    try { await within(unsubscribePush(subscription.endpoint)); } catch { /* A inscrição local ainda precisa ser removida. */ }
    const removed = await within(subscription.unsubscribe());
    setBrowserSubscribed(!removed);
    if (!removed) throw new DOMException("chave divergente", "InvalidStateError");
    setConfiguration(current => current ? { ...current, subscribed: false } : current);
  }
  function enable() {
    if (operating.current || subscribing.current || !configuration?.publicKey) return;
    const publicKey = configuration.publicKey;
    // A permissão é pedida diretamente no clique, antes de qualquer ida ao servidor.
    let requested: Promise<NotificationPermission>;
    try { requested = Notification.requestPermission(); }
    catch (error) { setResult(failure(error)); return; }
    void perform(async () => {
      let created: PushSubscription | null = null;
      let activation: Promise<ActionResult> | undefined;
      try {
        const granted = await requested; setPermission(granted);
        if (granted !== "granted") { setResult(failure(new DOMException("permissão", "NotAllowedError"))); return; }
        await within(navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }));
        const registration = await within(navigator.serviceWorker.ready);
        let subscription = await within(registration.pushManager.getSubscription());
        if (subscription) setBrowserSubscribed(true);
        const key = applicationKey(publicKey);
        if (subscription?.options.applicationServerKey) {
          const existing = new Uint8Array(subscription.options.applicationServerKey);
          if (existing.length !== key.length || !existing.every((byte, index) => byte === key[index])) {
            await replace(subscription); subscription = null;
          }
        }
        if (!subscription) {
          try { subscription = await subscribe(registration, key); }
          catch (error) {
            if (!(error instanceof Error) || error.name !== "InvalidStateError") throw error;
            const existing = await within(registration.pushManager.getSubscription());
            if (!existing) throw error;
            await replace(existing);
            subscription = await subscribe(registration, key);
          }
          created = subscription;
        }
        setBrowserSubscribed(true);
        activation = subscribePush(JSON.stringify(subscription.toJSON()));
        const saved = await within(activation);
        if (saved.error) {
          if (created) { const removed = await within(created.unsubscribe()); setBrowserSubscribed(!removed); }
          setResult(saved); return;
        }
        setConfiguration(current => current ? { ...current, subscribed: true } : current); setResult(saved);
      } catch (error) {
        // Após o prazo, a ação pode concluir no servidor; preserve a inscrição para reconectar ou desativar.
        if (created && !(error instanceof Error && error.name === "TimeoutError")) { try { const removed = await within(created.unsubscribe()); setBrowserSubscribed(!removed); } catch { /* A ação de desativar continua disponível. */ } }
        setResult(failure(error));
        void Promise.resolve(activation).catch(() => {}).then(() => {
          if (active.current) return refresh();
        }).catch(() => {});
      }
    });
  }
  function disable() {
    void perform(async () => {
      let removal: Promise<ActionResult> | undefined;
      try {
        const registration = await within(navigator.serviceWorker.getRegistration("/"));
        const subscription = registration ? await within(registration.pushManager.getSubscription()) : null;
        if (!subscription) { setBrowserSubscribed(false); setConfiguration(current => current ? { ...current, subscribed: false } : current); setResult({ message: "Este navegador não tem inscrição ativa." }); return; }
        removal = unsubscribePush(subscription.endpoint);
        const saved = await within(removal); setResult(saved);
        if (saved.error) return;
        setConfiguration(current => current ? { ...current, subscribed: false } : current);
        try {
          const removed = await within(subscription.unsubscribe()); setBrowserSubscribed(!removed);
          if (!removed) setResult({ error: true, message: "Desativadas no Orbit. A inscrição local não foi removida; tente desativar novamente." });
        } catch (error) { setResult({ error: true, message: "Desativadas no Orbit. Remova também a permissão nas configurações do navegador. " + failure(error).message }); }
      } catch (error) {
        setResult(failure(error));
        // Reconsultar antes da ação terminar faria o prazo da consulta expirar na mesma fila.
        void Promise.resolve(removal).catch(() => {}).then(() => {
          if (active.current) return refresh();
        }).catch(() => {});
      }
    });
  }
  function test() {
    void perform(async () => {
      try {
        const registration = await within(navigator.serviceWorker.getRegistration("/"));
        const subscription = registration ? await within(registration.pushManager.getSubscription()) : null;
        if (!subscription) { setResult({ error: true, message: "Ative as notificações neste aparelho antes de testar." }); return; }
        const saved = await within(testPush(subscription.endpoint, editionId)); setResult(saved);
        if (!saved.error && active.current) {
          refreshTimers.current.forEach(clearTimeout);
          refreshTimers.current = [5_000, 20_000].map(delay => setTimeout(() => {
            void refresh().catch(error => { if (active.current) setResult(failure(error)); });
          }, delay));
        }
      } catch (error) { setResult(failure(error)); }
    });
  }
  const enabled = browserSubscribed && configuration?.subscribed;
  const blocker = supportProblem === null ? "Verificando suporte a notificações…" : supportProblem
    || (!configuration ? "Consultando configuração do servidor…"
      : !configuration.publicKey ? configuration.message
        : permission === "denied" ? "Notificações bloqueadas no navegador. Altere a permissão do Orbit nas configurações e recarregue esta página para ativar."
          : pending ? "Aguarde a operação de notificações terminar."
            : !enabled || permission !== "granted" ? "Ative as notificações neste aparelho antes de testar."
              : "Notificações prontas para teste neste aparelho.");
  const delivery = configuration?.lastDelivery;
  const deliveryTime = delivery ? new Date(delivery.at).toLocaleString("pt-BR") : "";
  const lastDelivery = !delivery ? null
    : delivery.status === "sent" ? `enviado ao provedor em ${deliveryTime}`
      : delivery.status === "failed" ? `falhou em ${deliveryTime}`
        : delivery.status === "expired" ? "expirou sem envio"
          : delivery.status === "queued" ? "aguardando o worker"
            : delivery.status === "attempted" ? `tentativa iniciada em ${deliveryTime}; resultado não confirmado`
              : "cancelado sem envio";
  return <section className="panel" aria-labelledby="push-heading" aria-busy={pending}>
    <h2 id="push-heading">Notificações de edições</h2>
    <p>Receba um aviso discreto quando uma edição estiver pronta, mesmo com o Orbit fechado. Ative separadamente em cada aparelho.</p>
    <p id="push-blocker" className="field-help">{blocker}</p>
    {supportProblem === "" && <>
      {configuration?.publicKey && <p>{configuration.message}</p>}
      <p>Estado neste aparelho: <strong>{enabled ? "ativadas" : browserSubscribed ? "inscrição local não reconhecida pelo servidor: clique em Ativar para reconectar" : "desativadas"}</strong>.</p>
      {configuration && !configuration.workerOnline && <p className="field-help">Worker sem sinal recente</p>}
      {lastDelivery && <p className="field-help">Último envio: {lastDelivery}.</p>}
      <div className="access-actions">
        {!enabled && <button type="button" className="button" aria-describedby="push-blocker" disabled={pending || !configuration?.publicKey || permission === "denied"} onClick={enable}>Ativar neste aparelho</button>}
        {browserSubscribed && <button type="button" className="button secondary" aria-describedby="push-blocker" disabled={pending} onClick={disable}>Desativar neste aparelho</button>}
        <button type="button" className="button secondary" aria-describedby="push-blocker" disabled={pending || !enabled || !configuration?.publicKey || permission !== "granted"} onClick={test}>Testar notificação</button>
      </div>
      {editionId === null && <p className="field-help">Você já pode testar. Sem uma edição pronta, o aviso abre o arquivo de briefings.</p>}
      <p className="field-help">O servidor e o worker precisam estar ligados e com acesso à internet. O sistema pode adiar ou bloquear a entrega; navegador encerrado à força ou restrições de bateria podem impedir o aviso.</p>
    </>}
    {result.message && <p className={result.error ? "form-message error-text" : "form-message success-text"} role={result.error ? "alert" : "status"}>{result.message}</p>}
  </section>;
}
