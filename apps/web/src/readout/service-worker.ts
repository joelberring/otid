/**
 * Service worker för avläsningsskalet. Cachar bara de byggda, hashade
 * filerna under /readout/ så att sidan startar utan nät. API-anrop går
 * alltid till nätet; kön ligger i IndexedDB, inte här.
 */
export {};

type Asset = { url: string; sha256: string; mime: string };
declare const READOUT_SHELL_MANIFEST: Asset[];
declare const READOUT_SHELL_VERSION: string;
type LifetimeEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = { request: Request; respondWith(response: Promise<Response>): void };
type WorkerScope = {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
};
const worker = globalThis as unknown as WorkerScope;
const cacheName = `otid-readout-shell-${READOUT_SHELL_VERSION}`;
const absolute = (asset: Asset) => new URL(asset.url, worker.location.origin).href;
const indexAsset = READOUT_SHELL_MANIFEST.find((asset) => asset.url.endsWith("/index.html"));

async function verified(response: Response | undefined, asset: Asset): Promise<boolean> {
  if (!response || response.status !== 200 ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== asset.mime) return false;
  const hash = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") === asset.sha256;
}

worker.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  for (const asset of READOUT_SHELL_MANIFEST) {
    const response = await fetch(absolute(asset), { cache: "no-store", credentials: "omit" });
    if (!await verified(response, asset)) throw new Error(`Avläsningsskalet kunde inte verifieras: ${asset.url}`);
    await cache.put(absolute(asset), response);
  }
  await worker.skipWaiting();
})()));

worker.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith("otid-readout-shell-") && name !== cacheName) await caches.delete(name);
  }
  await worker.clients.claim();
})()));

worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.hash = "";
  const asset = url.pathname === "/readout/" ? indexAsset
    : READOUT_SHELL_MANIFEST.find((item) => absolute(item) === url.href);
  if (!asset) return;
  event.respondWith((async () => {
    // Filerna är versionsbundna: den verifierade kopian gäller tills en ny
    // service worker med ny version har installerats.
    const cached = await (await caches.open(cacheName)).match(absolute(asset));
    if (await verified(cached, asset)) return cached!;
    return fetch(absolute(asset), { cache: "no-store" });
  })());
});
