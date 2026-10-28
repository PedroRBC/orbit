import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { getDatabase } from "../src/db/index";
import { authConfigured, configureCredentials, newTotpSecret, revokeAllSessions, totpCode, totpURI } from "../src/lib/auth";

process.umask(0o077);
const command = process.argv[2];
const db = getDatabase();
// Sem TTY (testes/automação) lê linhas da entrada; com TTY esconde a senha.
const lines = process.stdin.isTTY ? null : createInterface({ input: process.stdin })[Symbol.asyncIterator]();
async function ask(question: string, hidden = false): Promise<string> {
  if (lines) { process.stdout.write(question + "\n"); return String((await lines.next()).value ?? ""); }
  if (!hidden) { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(question); } finally { rl.close(); } }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") { done(); resolve(value); return; }
        if (char === "\u0003") { done(); reject(new Error("Cancelado.")); return; }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", onData);
  });
}

try {
  if (command === "setup") {
    if (authConfigured(db) && (await ask("Já existe acesso configurado. Substituir e encerrar todas as sessões? (s/N) ")).trim().toLowerCase() !== "s") throw new Error("Nada foi alterado.");
    const password = await ask("Nova senha (mínimo 12 caracteres): ", true);
    if (password !== await ask("Repita a senha: ", true)) throw new Error("As senhas não conferem. Nada foi alterado.");
    if (password.length < 12) throw new Error("Use pelo menos 12 caracteres. Nada foi alterado.");
    const secret = newTotpSecret();
    console.log(`\nNo app autenticador, adicione uma conta pela chave (TOTP, 6 dígitos, 30 s):\n\n  ${secret.match(/.{1,4}/g)!.join(" ")}\n\nOu use este endereço: ${totpURI(secret)}\n`);
    const step = Math.floor(Date.now() / 30_000);
    const code = (await ask("Digite o código de 6 dígitos que o app mostra agora: ")).trim();
    if (![step - 1, step, step + 1].some(candidate => totpCode(secret, candidate) === code)) throw new Error("Código não confere. Nada foi alterado; rode o comando de novo.");
    const recovery = configureCredentials(db, password, secret);
    console.log(`\nAcesso configurado. Todas as sessões anteriores foram encerradas.\nGuarde estes códigos de recuperação (cada um vale uma vez, no lugar do código do app):\n\n  ${recovery.join("\n  ")}\n`);
  } else if (command === "logout-all") {
    revokeAllSessions(db);
    console.log("Todas as sessões foram encerradas.");
  } else if (command === "status") {
    console.log(authConfigured(db) ? "Acesso configurado." : "Acesso ainda não configurado. Rode: npm run auth -- setup");
  } else {
    console.log("Uso: npm run auth -- setup | logout-all | status");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao configurar o acesso.");
  process.exitCode = 1;
} finally { db.$client.close(); process.stdin.pause(); }
