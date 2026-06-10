const CACHE_NAME = "ait-procedure-runner-v18";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./src/styles.css?v=17",
  "./src/app.js?v=17",
  "./src/core.js?v=17",
  "./src/storage.js?v=17",
  "./src/templates.js?v=17",
  "./src/procedure-templates/ion-thruster-tvac-hotfire/template.json",
  "./src/procedure-templates/ion-thruster-tvac-hotfire/assets/vacuum-chamber.jpg",
  "./src/procedure-templates/ion-thruster-tvac-hotfire/assets/sec-thermal-vacuum-chamber.jpg",
  "./src/procedure-templates/ion-thruster-tvac-hotfire/assets/ion-thruster-plume.jpg",
  "./src/procedure-templates/ion-thruster-tvac-hotfire/assets/next-ion-engine.jpg",
  "./src/procedure-templates/optical-payload-tvac/template.json",
  "./src/procedure-templates/optical-payload-tvac/assets/imaging-spectrometer-tvac.jpg",
  "./src/procedure-templates/optical-payload-tvac/assets/coronagraph-test-chamber.jpg",
  "./src/procedure-templates/rf-hat-payload-facility/template.json",
  "./src/procedure-templates/rf-hat-payload-facility/assets/antenna-prototype-test.jpg",
  "./src/procedure-templates/rf-hat-payload-facility/assets/mro-antenna-gimbal-test.jpg",
  "./src/procedure-templates/rf-hat-payload-facility/assets/rf-anechoic-chamber.jpg",
  "./favicon.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_ASSETS.map(async (url) => {
        const response = await fetch(url, { cache: "reload" });
        if (!response.ok) throw new Error(`Unable to cache ${url}`);
        await cache.put(url, response);
      }))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
