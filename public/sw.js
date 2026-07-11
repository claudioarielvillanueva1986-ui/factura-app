// Service worker mínimo: su única función es habilitar la instalación de la
// PWA (Chrome/Android exige un SW con un handler de 'fetch'). A propósito NO
// cachea nada: así nunca sirve una versión vieja de la app (la app se actualiza
// sola con cada deploy, sin quedar pegada en caché).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* se deja pasar todo al navegador; sin caché */
});
