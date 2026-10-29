import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import webPush from "web-push";
import { openDatabase } from "../../src/db/index";
import { pushDeliveries, pushSubscriptions } from "../../src/db/push-schema";
import { getSetting, setSetting } from "../../src/lib/store";
import { test, expect } from "./fixtures";

test.beforeAll(() => {
  const db = openDatabase(resolve("test-results/e2e.db"));
  try {
    if (!getSetting(db, "push_vapid")) setSetting(db, "push_vapid", JSON.stringify(webPush.generateVAPIDKeys()));
  } finally { db.$client.close(); }
});

test("subscribe que nunca termina libera o botão com mensagem de prazo", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, "pushSubscribeCalls", { get: () => calls });
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    Notification.requestPermission = async () => "granted";
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = () => { calls++; return new Promise(() => {}); };
  });
  await page.goto("/configuracoes");
  const panel = page.getByRole("region", { name: "Notificações de edições" });
  const enable = panel.getByRole("button", { name: "Ativar neste aparelho", exact: true });
  await expect(enable).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await enable.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "pushSubscribeCalls"))).toBe(1);
  await expect(enable).toBeDisabled();
  // Um clique durante a espera não inicia outra inscrição.
  await enable.dispatchEvent("click");
  await page.clock.fastForward(31_000);
  await expect(panel.getByRole("alert")).toContainText("não respondeu em 30 segundos");
  await expect(enable).toBeEnabled();
  // O prazo libera a interface, mas não cancela a promessa nativa.
  await enable.click();
  expect(await page.evaluate(() => Reflect.get(window, "pushSubscribeCalls"))).toBe(1);
});

test("Server Action sem resposta libera a interface sem esperar a limpeza local", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    Notification.requestPermission = async () => "granted";
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => ({
      toJSON: () => ({ endpoint: "fixture-subscribe-action" }),
      unsubscribe: () => new Promise(() => {}),
    } as unknown as PushSubscription);
  });
  let saving = false;
  await page.route("**/configuracoes", route => {
    if (route.request().method() === "POST" && route.request().postData()?.includes("fixture-subscribe-action")) { saving = true; return; }
    return route.continue();
  });
  await page.goto("/configuracoes");
  const panel = page.getByRole("region", { name: "Notificações de edições" });
  const enable = panel.getByRole("button", { name: "Ativar neste aparelho", exact: true });
  await expect(enable).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await enable.click();
  await expect.poll(() => saving).toBe(true);
  await page.clock.fastForward(31_000);
  await expect(panel.getByRole("alert")).toContainText("não respondeu em 30 segundos");
  await expect(enable).toBeEnabled();
});

for (const leave of [false, true]) {
  test(`reconcilia ativação após mais de 60 segundos sem repetir inscrição; saída antecipada: ${leave}`, async ({ page }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/orbit-e2e-late-enable-${leave}`;
    const id = createHash("sha256").update(endpoint).digest("hex");
    const subscription = { endpoint, expirationTime: null, keys: { p256dh: webPush.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 1).toString("base64url") } };
    const db = openDatabase(resolve("test-results/e2e.db"));
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    try {
      await page.clock.install();
      await page.addInitScript(subscription => {
        let removed = 0, subscribed = 0;
        Object.defineProperty(window, "pushCalls", { get: () => ({ removed, subscribed }) });
        Object.defineProperty(Notification, "permission", { get: () => "granted" });
        Notification.requestPermission = async () => "granted";
        PushManager.prototype.getSubscription = async () => ({
          endpoint: subscription.endpoint, expirationTime: null,
          options: { applicationServerKey: null, userVisibleOnly: true }, toJSON: () => subscription,
          getKey: name => Uint8Array.from(atob(subscription.keys[name].replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0)).buffer,
          unsubscribe: async () => { removed++; return true; },
        } satisfies PushSubscription);
        PushManager.prototype.subscribe = () => { subscribed++; throw new Error("Não deve reinscrever automaticamente"); };
      }, subscription);
      let delaying = false, intercepted = false, actions = 0, mutations = 0;
      page.on("request", request => {
        if (request.headers()["next-action"]) actions++;
        if (request.method() === "POST" && request.postData()?.includes("p256dh")) mutations++;
      });
      await page.route("**/configuracoes", async route => {
        if (route.request().method() !== "POST" || !delaying) return route.continue();
        delaying = false; intercepted = true;
        await released;
        const response = await route.fetch();
        await route.fulfill({ response });
      });
      await page.goto("/configuracoes");
      const panel = page.getByRole("region", { name: "Notificações de edições" });
      const testButton = panel.getByRole("button", { name: "Testar notificação" });
      const enable = panel.getByRole("button", { name: "Ativar neste aparelho", exact: true });
      await expect(enable).toBeEnabled();
      await expect(testButton).toBeDisabled();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
      delaying = true;
      await enable.click();
      await expect.poll(() => intercepted).toBe(true);
      await page.clock.fastForward(31_000);
      await expect(panel.getByRole("alert")).toContainText("não respondeu em 30 segundos");
      await expect(enable).toBeEnabled();
      await page.clock.fastForward(31_000);
      expect(db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get()).toBeUndefined();
      if (leave) {
        await page.getByRole("link", { name: "Hoje", exact: true }).click();
        await expect(page).toHaveURL("/");
        await expect(panel).toHaveCount(0);
      }
      const beforeCompletion = actions;
      await page.clock.resume();
      const completed = page.waitForResponse(response => response.request().postData()?.includes("p256dh") === true);
      release();
      expect((await completed).status()).toBe(200);
      // Verifique a reconciliação, não o fechamento do stream RSC após consumir a ação.
      await expect.poll(() => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get()).toMatchObject(subscription.keys);
      if (leave) {
        await page.clock.fastForward(31_000);
        expect(actions).toBe(beforeCompletion);
        await expect(page).toHaveURL("/");
      } else {
        await expect(panel).toContainText("Estado neste aparelho: ativadas");
        await expect(testButton).toBeEnabled();
        expect(actions).toBe(beforeCompletion + 1);
      }
      expect(mutations).toBe(1);
      expect(await page.evaluate(() => Reflect.get(window, "pushCalls"))).toEqual({ removed: 0, subscribed: 0 });
    } finally {
      release();
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
      db.$client.close();
    }
  });
}

for (const lateRemoval of [false, true]) {
  test(`reconcilia desativação com resposta atrasada; remoção após o prazo: ${lateRemoval}`, async ({ page }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/orbit-e2e-disable-${lateRemoval}`;
    const id = createHash("sha256").update(endpoint).digest("hex");
    const db = openDatabase(resolve("test-results/e2e.db"));
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    try {
      db.insert(pushSubscriptions).values({ id, endpoint, p256dh: "fixture-invalid", auth: "fixture-invalid", createdAt: Date.now() }).run();
      await page.clock.install();
      await page.addInitScript(endpoint => {
        let removed = 0, subscribed = 0;
        Object.defineProperty(window, "pushCalls", { get: () => ({ removed, subscribed }) });
        Object.defineProperty(Notification, "permission", { get: () => "granted" });
        PushManager.prototype.getSubscription = async () => ({ endpoint, unsubscribe: async () => { removed++; return true; } } as PushSubscription);
        PushManager.prototype.subscribe = () => { subscribed++; throw new Error("Não deve reinscrever automaticamente"); };
      }, endpoint);
      let delaying = false, intercepted = false;
      await page.route("**/configuracoes", async route => {
        if (route.request().method() !== "POST" || !delaying) return route.continue();
        delaying = false; intercepted = true;
        if (lateRemoval) await released;
        const response = await route.fetch();
        if (!lateRemoval) await released;
        await route.fulfill({ response });
      });
      await page.goto("/configuracoes");
      const panel = page.getByRole("region", { name: "Notificações de edições" });
      const testButton = panel.getByRole("button", { name: "Testar notificação" });
      await expect(testButton).toBeEnabled();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
      delaying = true;
      await panel.getByRole("button", { name: "Desativar neste aparelho" }).click();
      await expect.poll(() => intercepted).toBe(true);
      if (!lateRemoval) await expect.poll(() => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get()).toBeUndefined();
      await page.clock.fastForward(31_000);
      await expect(panel.getByRole("alert")).toContainText("não respondeu em 30 segundos");
      await expect(panel.getByRole("button", { name: "Desativar neste aparelho" })).toBeEnabled();
      if (lateRemoval) await page.clock.fastForward(31_000);
      release();
      await expect(panel).toContainText("inscrição local não reconhecida pelo servidor: clique em Ativar para reconectar");
      await expect(panel.getByRole("button", { name: "Ativar neste aparelho", exact: true })).toBeEnabled();
      await expect(testButton).toBeDisabled();
      expect(await page.evaluate(() => Reflect.get(window, "pushCalls"))).toEqual({ removed: 0, subscribed: 0 });
      expect(db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get()).toBeUndefined();
    } finally {
      release();
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
      db.$client.close();
    }
  });
}

test("não reconsulta se sair antes da resposta do teste de notificação", async ({ page }) => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/orbit-e2e-leave-pending";
  const id = createHash("sha256").update(endpoint).digest("hex");
  const db = openDatabase(resolve("test-results/e2e.db"));
  const previousTimes = getSetting(db, "push_test_times");
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  try {
    // O teste usa o worker real, mas chaves inválidas impedem qualquer envio de rede.
    db.insert(pushSubscriptions).values({ id, endpoint, p256dh: "fixture-invalid", auth: "fixture-invalid", createdAt: Date.now() }).run();
    setSetting(db, "push_test_times", "[]");
    await page.clock.install();
    await page.addInitScript(endpoint => {
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      PushManager.prototype.getSubscription = async () => ({ endpoint } as PushSubscription);
    }, endpoint);
    let delaying = false, responseReady = false, actions = 0, delayedAction = "";
    page.on("request", request => { if (request.headers()["next-action"]) actions++; });
    await page.route("**/configuracoes", async route => {
      if (route.request().method() !== "POST" || !delaying) return route.continue();
      delaying = false;
      delayedAction = route.request().headers()["next-action"];
      const response = await route.fetch();
      responseReady = true;
      await released;
      await route.fulfill({ response });
    });
    await page.goto("/configuracoes");
    const panel = page.getByRole("region", { name: "Notificações de edições" });
    const testButton = panel.getByRole("button", { name: "Testar notificação" });
    await expect(testButton).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    delaying = true;
    await testButton.click();
    await expect.poll(() => responseReady).toBe(true);
    await page.getByRole("link", { name: "Hoje", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(panel).toHaveCount(0);
    await page.clock.resume();
    const completed = page.waitForResponse(response => response.request().headers()["next-action"] === delayedAction);
    release();
    expect((await completed).status()).toBe(200);
    const afterLeaving = actions;
    await page.clock.fastForward(5_000);
    expect(actions).toBe(afterLeaving);
    await page.clock.fastForward(15_000);
    expect(actions).toBe(afterLeaving);
    await expect(page).toHaveURL("/");
    await expect(panel).toHaveCount(0);
  } finally {
    release();
    db.delete(pushDeliveries).where(eq(pushDeliveries.subscriptionId, id)).run();
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
    setSetting(db, "push_test_times", previousTimes ?? "[]");
    db.$client.close();
  }
});

for (const [missing, message] of [
  ["secure", "Abra o Orbit por HTTPS."],
  ["serviceWorker", "Este navegador não permite service workers neste site."],
  ["PushManager", "Tela de Início"],
] as const) {
  test(`explica suporte ausente: ${missing}`, async ({ page }) => {
    await page.addInitScript(missing => {
      if (missing === "secure") Object.defineProperty(window, "isSecureContext", { value: false });
      else if (missing === "serviceWorker") Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
      else Reflect.deleteProperty(window, "PushManager");
    }, missing);
    await page.goto("/configuracoes");
    const panel = page.getByRole("region", { name: "Notificações de edições" });
    await expect(panel.locator("#push-blocker")).toContainText(message);
    await expect(panel.getByRole("button")).toHaveCount(0);
  });
}

test("reconecta inscrição local e troca chave divergente sem intervenção manual", async ({ page }) => {
  await page.addInitScript(() => {
    let removed = 0, subscribed = 0;
    Object.defineProperty(window, "pushCalls", { get: () => ({ removed, subscribed }) });
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    Notification.requestPermission = async () => "granted";
    PushManager.prototype.getSubscription = async () => ({
      endpoint: "https://exemplo.org/inscricao-sintetica",
      options: { applicationServerKey: new Uint8Array([1]).buffer },
      unsubscribe: async () => { removed++; return true; },
    } as PushSubscription);
    PushManager.prototype.subscribe = async () => { subscribed++; throw new DOMException("sintético", "AbortError"); };
  });
  await page.goto("/configuracoes");
  const panel = page.getByRole("region", { name: "Notificações de edições" });
  await expect(panel).toContainText("inscrição local não reconhecida pelo servidor: clique em Ativar para reconectar");
  await expect(panel.getByRole("button", { name: "Testar notificação" })).toHaveAttribute("aria-describedby", "push-blocker");
  await panel.getByRole("button", { name: "Ativar neste aparelho", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Helium");
  expect(await page.evaluate(() => Reflect.get(window, "pushCalls"))).toEqual({ removed: 1, subscribed: 1 });
});

for (const leave of [false, true]) {
  test(`reconsulta o último envio aos 5 e 20 segundos; saída antecipada: ${leave}`, async ({ page }) => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/orbit-e2e-synthetic";
    const id = createHash("sha256").update(endpoint).digest("hex");
    const db = openDatabase(resolve("test-results/e2e.db"));
    const previousTimes = getSetting(db, "push_test_times");
    try {
      // Chaves deliberadamente inválidas: o worker falha na validação, antes de DNS/rede.
      db.insert(pushSubscriptions).values({ id, endpoint, p256dh: "fixture-invalid", auth: "fixture-invalid", createdAt: Date.now() }).run();
      setSetting(db, "push_test_times", "[]");
      db.insert(pushDeliveries).values({ subscriptionId: id, editionId: 0, kind: "test", status: "expired", createdAt: Date.now() }).run();
      await page.clock.install();
      await page.addInitScript(endpoint => {
        Object.defineProperty(Notification, "permission", { get: () => "granted" });
        PushManager.prototype.getSubscription = async () => ({ endpoint } as PushSubscription);
      }, endpoint);
      let actions = 0;
      page.on("request", request => { if (request.headers()["next-action"]) actions++; });
      await page.goto("/configuracoes");
      const panel = page.getByRole("region", { name: "Notificações de edições" });
      const testButton = panel.getByRole("button", { name: "Testar notificação" });
      await expect(testButton).toBeEnabled();
      await expect(panel).toContainText("Estado neste aparelho: ativadas");
      await expect(panel).toContainText("Último envio: expirou sem envio");
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
      await testButton.click();
      await expect(panel.getByRole("status")).toContainText("Teste na fila");
      await expect.poll(() => db.select().from(pushDeliveries).where(eq(pushDeliveries.subscriptionId, id)).orderBy(desc(pushDeliveries.id)).get()?.status).toBe("failed");
      await page.clock.fastForward(5_000);
      await expect(panel).toContainText("Último envio: falhou em");
      const afterFiveSeconds = actions;
      if (leave) {
        await page.getByRole("link", { name: "Hoje", exact: true }).click();
        await expect(page).toHaveURL("/");
        await expect(panel).toHaveCount(0);
        await page.clock.fastForward(15_000);
        expect(actions).toBe(afterFiveSeconds);
      } else {
        db.update(pushDeliveries).set({ status: "sent" }).where(eq(pushDeliveries.subscriptionId, id)).run();
        await page.clock.fastForward(15_000);
        await expect(panel).toContainText("Último envio: enviado ao provedor em");
        expect(actions).toBe(afterFiveSeconds + 1);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: "test-results/push-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: "test-results/push-desktop.png", fullPage: true });
      }
    } finally {
      db.delete(pushDeliveries).where(eq(pushDeliveries.subscriptionId, id)).run();
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
      setSetting(db, "push_test_times", previousTimes ?? "[]");
      db.$client.close();
    }
  });
}

for (const name of ["NotAllowedError", "NetworkError", "InvalidStateError"]) {
  test(`explica ${name} sem exibir texto bruto`, async ({ page }) => {
    await page.addInitScript(name => {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
      Notification.requestPermission = async () => "granted";
      PushManager.prototype.getSubscription = async () => null;
      PushManager.prototype.subscribe = async () => { throw new DOMException("detalhe-sintetico-nao-exibir", name); };
    }, name);
    await page.goto("/configuracoes");
    const panel = page.getByRole("region", { name: "Notificações de edições" });
    await panel.getByRole("button", { name: "Ativar neste aparelho", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText(name === "NotAllowedError" ? "Permissão não concedida" : `Não foi possível ativar (${name})`);
    await expect(panel).not.toContainText("detalhe-sintetico-nao-exibir");
  });
}

test("AbortError explica navegador sem serviço de push", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    Notification.requestPermission = async () => "granted";
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => { throw new DOMException("Registration failed - push service error", "AbortError"); };
  });
  await page.goto("/configuracoes");
  const panel = page.getByRole("region", { name: "Notificações de edições" });
  await panel.getByRole("button", { name: "Ativar neste aparelho", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("serviços do Google");
  await expect(panel.getByRole("alert")).toContainText("Helium");
});
