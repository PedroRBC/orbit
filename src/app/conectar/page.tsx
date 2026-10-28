import { connection } from "next/server";
import extensionManifest from "../../../browser-extension/manifest.json";
import { resolve } from "node:path";
import Link from "next/link";
import { getDatabase } from "../../db/index";
import { bridgeURL } from "../../lib/extension-http";
import { connectionStatus } from "../../lib/extension";
import { disconnectExtension } from "../actions";
import { ActionForm, PairingForm, SubmitButton, WorkRefresh } from "../components";

export const metadata = { title: "Conectar navegador" };
export default async function ConnectPage() {
  await connection();
  const status = connectionStatus(getDatabase());
  return <><WorkRefresh active={status.paired}/><div className="page-heading"><div><h1>Seu navegador. Seu login.</h1><p>Entre normalmente pelo Helium. O Orbit não abre um navegador automatizado nem pede seus cookies.</p></div></div>
    <section className="panel"><h2>Conectar a extensão local</h2><p>Instalação manual única. A coleta usa as sessões deste navegador e precisa que ele esteja aberto.</p>
      <ol className="connection-steps"><li>No Helium, abra <code>chrome://extensions</code> e ative o modo de desenvolvedor.</li><li>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta abaixo, gerada por <code>npm run dev</code> ou <code>npm run build:extension</code>.<pre>{resolve("browser-extension/dist")}</pre></li><li>Abra o popup da extensão <strong>Orbit — coletor local</strong>. Informe o endereço da ponte local <code>{bridgeURL()}</code> e cole o código gerado nesta tela.</li><li>Faça login nos sites pelo navegador normal, ative suas fontes e clique em <strong>Atualizar fontes</strong> no Orbit.</li></ol>
      <PairingForm/>
    </section>
    {status.paired && status.version !== extensionManifest.version && <div className="notice"><div><strong>Atualize a extensão para {extensionManifest.version}.</strong><p>Em chrome://extensions no Helium, clique em Recarregar na extensão Orbit após a coleta atual terminar. O pareamento é preservado.</p></div></div>}
    <section className="panel connection-state"><h2>Estado da conexão</h2><dl className="detail-list"><div><dt>Versão da extensão</dt><dd>{status.version || "Não reportada — recarregue em chrome://extensions"}</dd></div><div><dt>Pareamento</dt><dd>{status.paired ? "Extensão pareada" : "Ainda não pareada"}</dd></div><div><dt>Navegador</dt><dd className={status.online ? "success-text" : "warning-text"}>{status.online ? "Extensão online" : "Sem conexão recente"}</dd></div>{status.lastSeen && <div><dt>Último contato</dt><dd>{new Date(status.lastSeen).toLocaleString("pt-BR")}</dd></div>}</dl><p className="field-help">A extensão consulta pedidos a cada 30 segundos. Sem navegador aberto, a fonte pausa com aviso; não há fallback para um login inseguro.</p>{status.paired && <ActionForm action={disconnectExtension}><SubmitButton className="button secondary">Revogar conexão</SubmitButton></ActionForm>}</section>
    <div className="notice privacy-note"><div><strong>Permissões e privacidade</strong><p>A extensão só acessa os quatro feeds e o Orbit em localhost. Não possui permissão de cookies, debugger ou webRequest. Apenas metadados chegam ao app; senha e sessão ficam no navegador. Ela cria e fecha somente abas próprias, sem publicar, curtir ou seguir.</p><p>Os perfis antigos do Playwright não são apagados, mas não são usados pelo novo fluxo.</p></div></div><Link className="text-link" href="/fontes">Voltar às fontes</Link>
  </>;
}
