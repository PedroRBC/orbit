import "dotenv/config";
import { browserURLs, platformLabels, type BrowserPlatform } from "../src/collectors/types";
import { openDefaultBrowser } from "../src/lib/default-browser";

const input = process.argv[2];
if (!input || !Object.hasOwn(browserURLs, input)) {
  console.error("Uso: npm run login -- youtube|x|instagram|valete. Abre seu navegador habitual, sem automação.");
  process.exit(1);
}
const platform = input as BrowserPlatform;
try {
  await openDefaultBrowser(platform);
  console.log(`${platformLabels[platform]} aberto no navegador padrão. Faça login normalmente, sem janela controlada pelo Orbit.`);
  console.log(`Para coletar, conecte a extensão: http://127.0.0.1:${process.env.PORT || "3000"}/conectar`);
} catch {
  console.error("Não foi possível abrir o navegador padrão. Abra o site manualmente e confira o manipulador HTTPS do sistema.");
  process.exitCode = 1;
}
