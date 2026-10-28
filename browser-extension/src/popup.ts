const form = document.querySelector<HTMLFormElement>("#pair")!;
const message = document.querySelector<HTMLElement>("#status")!;
const disconnect = document.querySelector<HTMLButtonElement>("#disconnect")!;
async function refresh() {
  const state = await chrome.storage.local.get<{ status?: string; connection?: { server: string } }>(["status", "connection"]);
  message.textContent = state.status || "Ainda não conectada. Gere um código em Orbit → Conectar navegador.";
  disconnect.hidden = !state.connection;
  if (state.connection?.server) document.querySelector<HTMLInputElement>("#server")!.value = state.connection.server;
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.disabled = true; message.textContent = "Conectando…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "pair", server: document.querySelector<HTMLInputElement>("#server")!.value, code: document.querySelector<HTMLInputElement>("#code")!.value });
    if (result?.error) throw new Error(result.error);
    document.querySelector<HTMLInputElement>("#code")!.value = "";
    await refresh();
  } catch (error) { message.textContent = error instanceof Error ? error.message : "Falha ao conectar."; }
  finally { submit.disabled = false; }
});
disconnect.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "disconnect" }); await refresh(); });
document.querySelector<HTMLButtonElement>("#check")!.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "check" }); await refresh(); });
void refresh();
