// Orbit: guarda só a página offline estática. Dados, sessões, POSTs e Server Actions vão sempre à rede.
const CACHE = "orbit-offline-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

function notificationURL(value, test) {
  if (value === "/briefings" && test === true) return new URL(value, self.location.origin);
  if (typeof value !== "string" || value.length > 32 || !/^\/briefings\/[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value.slice("/briefings/".length));
  if (!Number.isSafeInteger(id) || value !== `/briefings/${id}`) return null;
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin ? url : null;
}
self.addEventListener("push", event => {
  try {
    const text = event.data?.text();
    if (!text || text.length > 512) return;
    const data = JSON.parse(text);
    const url = notificationURL(data?.url, data?.test);
    if (!url) return;
    event.waitUntil(self.registration.showNotification("Orbit", {
      body: data.test === true ? "Teste das notificações do Orbit." : "Uma nova edição está disponível.",
      icon: "/icons/icon-192.png",
      tag: `orbit-${data.test === true ? "test" : "edition"}-${url.pathname.split("/").pop()}`,
      renotify: false,
      data: { url: url.pathname, test: data.test === true },
    }));
  } catch { /* Payload inválido nunca vira conteúdo nem destino de navegação. */ }
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = notificationURL(event.notification.data?.url, event.notification.data?.test);
  if (!url) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === url.href);
    return existing ? existing.focus() : self.clients.openWindow(url.href);
  }));
});
