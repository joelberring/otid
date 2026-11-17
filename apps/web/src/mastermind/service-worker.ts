/**
 * Service worker för spelet (samma som avläsningsskalets): cachar bara de byggda, hashade filerna under /mastermind/ så att
 * sidan startar utan nät, t.ex. vid en träning i skogen.
 */
export {};

type Asset = { url: string; sha256: string; mime: string };
declare const MASTERMIND_SHELL_MANIFEST: Asset[];
declare const MASTERMIND_SHELL_VERSION: string;
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
const cacheName = `otid-mastermind-shell-${MASTERMIND_SHELL_VERSION}`;
const absolute = (asset: Asset) => new URL(asset.url, worker.location.origin).href;
const indexAsset = MASTERMIND_SHELL_MANIFEST.find((asset) => asset.url.endsWith("/index.html"));

async function verified(response: Response | undefined, asset: Asset): Promise<boolean> {
  if (!response || response.status !== 200 ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== asset.mime) return false;
  const hash = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") === asset.sha256;
}

worker.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  for (const asset of MASTERMIND_SHELL_MANIFEST) {
    const response = await fetch(absolute(asset), { cache: "no-store", credentials: "omit" });
    if (!await verified(response, asset)) throw new Error(`Spelets skal kunde inte verifieras: ${asset.url}`);
    await cache.put(absolute(asset), response);
  }
  await worker.skipWaiting();
})()));

worker.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith("otid-mastermind-shell-") && name !== cacheName) await caches.delete(name);
  }
  await worker.clients.claim();
})()));

worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.hash = "";
  const asset = url.pathname === "/mastermind/" ? indexAsset
    : MASTERMIND_SHELL_MANIFEST.find((item) => absolute(item) === url.href);
  if (!asset) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(absolute(asset));
    if (await verified(cached, asset)) return cached!;
    return fetch(absolute(asset), { cache: "no-store" });
  })());
});
