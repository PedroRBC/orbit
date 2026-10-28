import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Orbit } from "lucide-react";
import { getDatabase } from "../../db/index";
import { authConfigured } from "../../lib/auth";
import { requestOrigin } from "../../lib/hosts";
import { hasSession, safeNext } from "../../lib/session";
import { ActionForm, SubmitButton } from "../components";
import { login } from "./actions";

export const metadata = { title: "Entrar" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await hasSession()) redirect(next);
  const configured = authConfigured(getDatabase()), secure = requestOrigin(await headers()) !== null;
  return <main id="main" className="login-shell"><section className="panel login-panel">
    <div className="brand"><Orbit size={30} strokeWidth={1.5} aria-hidden="true"/>orbit</div>
    <h1>Entrar no Orbit</h1>
    {!configured ? <><p>O acesso ainda não foi configurado. No servidor, crie a senha e o autenticador:</p><pre>docker exec -it &lt;contêiner&gt; npm run auth -- setup</pre><p className="field-help">Fora do Docker, use <code>npm run auth -- setup</code> na pasta do Orbit. Depois, recarregue esta página.</p></>
      : !secure ? <p className="warning-text" role="alert">Abra o Orbit pelo endereço HTTPS. Senha e código não são enviados por uma conexão sem criptografia.</p>
      : <ActionForm action={login} className="stack-form"><input type="hidden" name="next" value={next}/><label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024}/><label htmlFor="code">Código do autenticador</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} aria-describedby="code-help"/><p id="code-help" className="field-help">Seis dígitos do app autenticador ou um código de recuperação.</p><SubmitButton>Entrar</SubmitButton></ActionForm>}
  </section></main>;
}
