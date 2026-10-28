import { spawn } from "node:child_process";
import { browserURLs, type BrowserPlatform } from "../collectors/types";

export function browserCommand(platform: BrowserPlatform, system: NodeJS.Platform = process.platform) {
  if (!Object.hasOwn(browserURLs, platform)) throw new Error("Plataforma inválida.");
  const url = browserURLs[platform];
  if (system === "darwin") return { command: "open", args: [url] };
  if (system === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  // GIO usa o manipulador HTTPS, sem depender do default-web-browser inconsistente do desktop.
  return { command: "gio", args: ["open", url] };
}
export function openDefaultBrowser(platform: BrowserPlatform): Promise<void> {
  const { command, args } = browserCommand(platform);
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ command, args, { stdio: "ignore", shell: false });
    child.once("error", () => reject(new Error("Não foi possível abrir seu navegador. Abra o site normalmente pelo Helium.")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("O sistema não abriu o navegador. Confira o manipulador de links HTTPS.")));
  });
}
