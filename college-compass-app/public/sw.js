/* College Compass service worker — minimal offline shell + data cache.
 * Bump VERSION to invalidate old caches on deploy-breaking changes.
 * Strategy:
 *   - cache-first (with background refresh) for the app shell and data/colleges.json
 *   - network-first (cache fallback) for everything else same-origin
 *   - never touches /functions/ (Supabase edge) or api.openai.com, or non-GET requests
 */
const VERSION = "v1";
const CACHE = `cc2-${VERSION}`;
const SCOPE = self.registration.scope; // e.g. https://host/College-compass/app/
const SHELL = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "data/colleges.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // Best-effort precache: one missing file must not fail the install.
        Promise.all(SHELL.map((p) => cache.add(new Request(new URL(p, SCOPE), { cache: "reload" })).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cc2-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(req, url) {
  if (req.mode === "navigate") return true;
  if (url.pathname.endsWith("/data/colleges.json")) return true;
  if (url.pathname.startsWith(new URL(SCOPE).pathname + "assets/")) return true; // hashed build assets
  return SHELL.some((p) => new URL(p, SCOPE).href === url.href);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const key = req.mode === "navigate" ? new URL("./", SCOPE).href : req;
  const hit = await cache.match(key);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit; // background refresh continues
  const res = await refresh;
  return res || new Response("Offline", { status: 503, statusText: "Offline" });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.openai.com") return;
  if (url.pathname.includes("/functions/")) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith(isShellRequest(req, url) ? cacheFirst(req) : networkFirst(req));
});
