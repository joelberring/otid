type Asset = { url: string; sha256: string; mime: string };
declare const CHECKIN_SHELL_MANIFEST: Asset[];
declare const CHECKIN_SHELL_VERSION: string;
type LifetimeEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = { request: Request; respondWith(response: Promise<Response>): void };
type WorkerScope = {
  location: Location; clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent & LifetimeEvent) => void): void;
};
const worker = globalThis as unknown as WorkerScope;
const cacheName = `otid-checkin-shell-${CHECKIN_SHELL_VERSION}`;
const absolute = (asset: Asset) => new URL(asset.url, worker.location.origin).href;

async function verified(response: Response | undefined, asset: Asset): Promise<boolean> {
  if (!response || response.status !== 200 || response.redirected ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== asset.mime) return false;
  const hash = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") === asset.sha256;
}

worker.addEventListener("install", (event) => event.waitUntil((async () => {
  const responses = await Promise.all(CHECKIN_SHELL_MANIFEST.map(async (asset) => {
    const response = await fetch(absolute(asset), { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!await verified(response, asset)) throw new Error("Checkin shell integrity failure");
    return response;
  }));
  const cache = await caches.open(cacheName);
  for (let index = 0; index < CHECKIN_SHELL_MANIFEST.length; index++) {
    await cache.put(absolute(CHECKIN_SHELL_MANIFEST[index]!), responses[index]!);
  }
})()));
worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // A navigation fragment selects local UI state, not a different cached resource.
  // Keep origin, path and query exact: private API/RSC/query variants remain excluded.
  const resourceUrl = new URL(event.request.url);
  resourceUrl.hash = "";
  const asset = CHECKIN_SHELL_MANIFEST.find((item) => absolute(item) === resourceUrl.href);
  if (!asset) return;
  event.respondWith((async () => {
    const response = await (await caches.open(cacheName)).match(absolute(asset));
    if (!await verified(response, asset)) return new Response("Offline shell unavailable", { status: 503 });
    return response!;
  })());
});
worker.addEventListener("message", (event) => {
  if (event.data !== "CHECKIN_SHELL_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const complete = (await Promise.all(CHECKIN_SHELL_MANIFEST.map(async (asset) => verified(await cache.match(absolute(asset)), asset)))).every(Boolean);
      event.ports[0]!.postMessage({ kind: "CHECKIN_SHELL_STATUS", complete, version: CHECKIN_SHELL_VERSION,
        assets: CHECKIN_SHELL_MANIFEST.map(absolute) });
    } catch { event.ports[0]!.postMessage({ kind: "CHECKIN_SHELL_STATUS", complete: false }); }
  })());
});
