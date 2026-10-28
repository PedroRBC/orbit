import { headers } from "next/headers";
import { requireSession } from "../../../lib/session";
import extensionManifest from "../../../../browser-extension/manifest.json";
import Link from "next/link";
import { getDatabase } from "../../../db/index";
import { requestOrigin } from "../../../lib/hosts";
import { connectionStatus } from "../../../lib/extension";
import { disconnectExtension } from "../../actions";
import { ActionForm, PairingForm, SubmitButton, WorkRefresh } from "../../components";

export const metadata = { title: "Conectar navegador" };
export default async function ConnectPage() {
  await requireSession();
  const origin = requestOrigin(await headers());
  const status = connectionStatus(getDatabase());
  return <><WorkRefresh active={status.paired}/><div className="page-heading"><div><h1>Seu navegador. Seu login.</h1><p>Entre normalmente pelo Helium no seu computador. O Orbit não abre um navegador automatizado nem pede seus cookies.</p></div></div>
    <section className="panel"><h2>Conectar a extensão</h2><p>Instalação manual única. A coleta usa as sessões do seu navegador e só acontece enquanto ele está aberto; o resto do Orbit continua disponível sem ele.</p>
      <ol className="connection-steps"><li><a className="text-link" href="/conectar/extensao" download>Baixe a extensão {extensionManifest.version}</a> e descompacte o arquivo no seu computador.</li><li>No Helium, abra <code>chrome://extensions</code>, ative o modo de desenvolvedor, clique em <strong>Carregar sem compactação</strong> e selecione a pasta <code>orbit-extensao</code>.</li><li>Abra o popup <strong>Orbit — coletor</strong>, informe o endereço {origin ? <code>{origin}</code> : "HTTPS do Orbit"} e cole o código gerado nesta tela. Quando o Helium pedir acesso a esse endereço, permita.</li><li>Faça login nos sites pelo navegador normal, ative suas fontes e clique em <strong>Atualizar fontes</strong> no Orbit.</li></ol>
      <PairingForm/>
    </section>
    {status.paired && status.version !== extensionManifest.version && <div className="notice"><div><strong>Atualize a extensão para {extensionManifest.version}.</strong><p>Baixe a extensão de novo, substitua os arquivos da pasta <code>orbit-extensao</code> e clique em Recarregar em chrome://extensions após a coleta atual terminar. O pareamento é preservado.</p></div></div>}
    <section className="panel connection-state"><h2>Estado da conexão</h2><dl className="detail-list"><div><dt>Versão da extensão</dt><dd>{status.version || "Não reportada — recarregue em chrome://extensions"}</dd></div><div><dt>Pareamento</dt><dd>{status.paired ? "Extensão pareada" : "Ainda não pareada"}</dd></div><div><dt>Navegador</dt><dd className={status.online ? "success-text" : "warning-text"}>{status.online ? "Extensão online" : "Sem conexão recente"}</dd></div>{status.lastSeen && <div><dt>Último contato</dt><dd>{new Date(status.lastSeen).toLocaleString("pt-BR")}</dd></div>}</dl><p className="field-help">A extensão consulta pedidos a cada 30 segundos. Sem navegador aberto, a fonte pausa com aviso; não há fallback para um login inseguro.</p>{status.paired && <ActionForm action={disconnectExtension}><SubmitButton className="button secondary">Revogar conexão</SubmitButton></ActionForm>}</section>
    <div className="notice privacy-note"><div><strong>Permissões e privacidade</strong><p>A extensão só acessa os quatro feeds e o endereço do Orbit que você permitir. Não possui permissão de cookies, debugger ou webRequest. Apenas metadados chegam ao app; senha e sessão ficam no navegador. Ela cria e fecha somente abas próprias, sem publicar, curtir ou seguir.</p><p>Os perfis antigos do Playwright não são apagados, mas não são usados pelo novo fluxo.</p></div></div><Link className="text-link" href="/fontes">Voltar às fontes</Link>
  </>;
}
