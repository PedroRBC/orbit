"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode, type AnchorHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { ArrowUpRight, RefreshCw, ThumbsUp, ThumbsDown, Bookmark, Check } from "lucide-react";
import { beginPairing, recordClick, requestCollection, saveFeedback, type ActionResult } from "./actions";

export { Navigation } from "./navigation";

export function ActionForm({ action, children, className = "" }: { action: (previous: ActionResult, data: FormData) => Promise<ActionResult>; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, { message: "" });
  return <form action={formAction} className={className}>{children}{state.message && <p className={state.error ? "form-message error-text" : "form-message success-text"} role={state.error ? "alert" : "status"}>{state.message}</p>}</form>;
}
export function SubmitButton({ children, className = "button", label }: { children: ReactNode; className?: string; label?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-label={label} aria-busy={pending}>{pending ? "Aguarde…" : children}</button>;
}
export function CollectButton() {
  return <ActionForm action={requestCollection} className="collect-form"><SubmitButton className="button secondary"><RefreshCw size={16} aria-hidden="true"/>Atualizar fontes</SubmitButton></ActionForm>;
}
export function WorkRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
export function PairingForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(beginPairing, { message: "" });
  return <form action={action} className="stack-form"><button className="button" type="submit" disabled={pending}>Gerar código de pareamento</button>{state.message && <p role="status" className="form-message">{state.message}</p>}{state.code && <div className="pairing-code"><label htmlFor="pairing-code">Código temporário</label><input id="pairing-code" value={state.code} readOnly autoComplete="off" onFocus={event => event.currentTarget.select()}/><p className="field-help">Copie para a extensão. Vale por 10 minutos e uma única utilização.</p></div>}</form>;
}

export function FeedbackControls({ rawId, vote = 0, saved = false, seen = false }: { rawId: string; vote?: number; saved?: boolean; seen?: boolean }) {
  const [state, action, pending] = useActionState(saveFeedback, { message: "" });
  return <form action={action} className="feedback-controls" aria-label="Sua opinião sobre este item">
    <input type="hidden" name="rawId" value={rawId}/>
    <button type="submit" name="action" value="up" disabled={pending} aria-label="Gostei" aria-pressed={vote === 1}><ThumbsUp size={15}/><span>Gostei</span></button>
    <button type="submit" name="action" value="down" disabled={pending} aria-label="Não gostei" aria-pressed={vote === -1}><ThumbsDown size={15}/><span>Não gostei</span></button>
    <button type="submit" name="action" value="save" disabled={pending} aria-label="Salvar" aria-pressed={saved}><Bookmark size={15}/><span>{saved ? "Salvo" : "Salvar"}</span></button>
    <button type="submit" name="action" value="seen" disabled={pending} aria-label="Já vi" aria-pressed={seen}><Check size={15}/><span>Já vi</span></button>
    <span className={state.error ? "error-text feedback-error" : "sr-only"} role={state.error ? "alert" : "status"}>{state.message}</span>
  </form>;
}

export function TrackedLink({ rawId, ...props }: { rawId: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} onClick={() => { void recordClick(rawId); }} onAuxClick={event => { if (event.button === 1) void recordClick(rawId); }}/>;
}

export function ExternalMark() { return <ArrowUpRight size={16} aria-hidden="true"/>; }
