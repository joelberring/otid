/**
 * Steg 67 (ADR-0181 beslut 7): service worker för banläggningen utan täckning. Registreras bara när banläggaren väljer
 * "Spara för offline", med scope `/admin/<tävling>/course-setting` (en registrering per tävling), så den styr aldrig
 * avläsningen (`/readout/`, egen service worker), arbetsytan eller de publika sidorna.
 *
 * Den sparar bara sidskalet: banläggningens sida (HTML) och Nexts byggda filer under `/_next/static/` som sidan laddar.
 * API-anrop går alltid till nätet och sparas aldrig här; banläggningen, kartfilen och kön ligger i IndexedDB.
 *
 * - Sidan: nätet först (högst 6 s), annars den sparade kopian. Bara ett riktigt svar (200, HTML, ingen omdirigering) sparas.
 * - `/_next/static/`: en sparad fil med `immutable` (driftbygget, namnen har hash) ges direkt; annars nätet först och den
 *   sparade kopian utan nät (utvecklingsläget).
 * - Meddelandet `cache` från sidan: spara sidan och filerna den redan laddat (de laddades innan service workern fanns).
 */
export {};

type ExtendableEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = { request: Request; respondWith(response: Promise<Response>): void; waitUntil(promise: Promise<unknown>): void };
type MessageEvent = ExtendableEvent & { data: unknown; ports: readonly MessagePort[] };
type WorkerScope = {
  location: Location;
  registration: { scope: string };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};
const worker = globalThis as unknown as WorkerScope;
const CACHE = "otid-course-setting-v1";
const PAGE_TIMEOUT_MS = 6_000;
const origin = worker.location.origin;
const scopePath = new URL(worker.registration.scope).pathname.replace(/\/$/, "");

const isStatic = (url: URL) => url.origin === origin && url.pathname.startsWith("/_next/static/");
/** Banläggningens sida (och utskriften av beskrivningarna) för den här tävlingen, utan frågedel. */
const isPage = (url: URL) => url.origin === origin && (url.pathname === scopePath || url.pathname.startsWith(`${scopePath}/`));
const pageKey = (url: URL) => `${origin}${url.pathname}`;

function cacheable(response: Response, html: boolean): boolean {
  if (!response.ok || response.status !== 200 || response.redirected || response.type !== "basic") return false;
  const type = response.headers.get("content-type") ?? "";
  return html ? type.startsWith("text/html") : true;
}

async function store(key: string, response: Response, html: boolean): Promise<boolean> {
  if (!cacheable(response, html)) return false;
  await (await caches.open(CACHE)).put(key, response);
  return true;
}

worker.addEventListener("install", event => event.waitUntil(worker.skipWaiting()));
worker.addEventListener("activate", event => event.waitUntil(worker.clients.claim()));

worker.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && isPage(url)) {
    event.respondWith((async () => {
      const network = fetch(request).then(async response => {
        await store(pageKey(url), response.clone(), true);
        return response;
      });
      const cached = await caches.match(pageKey(url), { cacheName: CACHE });
      if (!cached) return network;
      // Svarar inte nätet inom en stund (svag täckning) ges den sparade sidan; den nya sparas ändå när den kommer.
      const timeout = new Promise<Response>(resolve => setTimeout(() => resolve(cached), PAGE_TIMEOUT_MS));
      event.waitUntil(network.catch(() => undefined));
      return Promise.race([network.catch(() => cached), timeout]);
    })());
    return;
  }
  if (!isStatic(url)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: CACHE });
    if (cached && /immutable/.test(cached.headers.get("cache-control") ?? "")) return cached;
    try {
      const response = await fetch(request);
      if (cacheable(response, false)) await store(request.url, response.clone(), false);
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});

worker.addEventListener("message", event => {
  const data = event.data as { type?: string; urls?: unknown } | null;
  if (data?.type !== "cache" || !Array.isArray(data.urls)) return;
  const reply = event.ports[0];
  event.waitUntil((async () => {
    let saved = 0, failed = 0;
    for (const raw of data.urls as unknown[]) {
      if (typeof raw !== "string") continue;
      let url: URL;
      try { url = new URL(raw, origin); } catch { continue; }
      const page = isPage(url);
      if (!page && !isStatic(url)) continue;
      try {
        const response = await fetch(url.href, { credentials: "same-origin", cache: page ? "no-store" : "default" });
        if (await store(page ? pageKey(url) : url.href, response, page)) saved += 1; else failed += 1;
      } catch { failed += 1; }
    }
    reply?.postMessage({ type: "cached", saved, failed });
  })());
});
