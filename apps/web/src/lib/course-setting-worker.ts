/**
 * Steg 67: kartans och vägvalens Worker utan nät. En Worker som startas från sin egen adress (`/_next/static/chunks/…`)
 * styrs inte av sidans service worker (adressen ligger utanför banläggningens scope), så dess filer kan inte hämtas ur
 * telefonens lagring. En Worker som startas från en blob-adress styrs däremot av sidans service worker. När sidan är
 * sparad för offline startas därför Workern via en liten blob som laddar samma skript (`importScripts`); byggverktygets
 * parametrar (vilka filer Workern behöver) följer med i adressens `#params=`, som Turbopacks start läser.
 *
 * Adresserna sparas också (`workerResources`), så att "Spara för offline" kan lägga Workerns filer i telefonen.
 */
const resources = new Set<string>();

/** Workerns filer (samma ursprung) som sidan har startat: skriptet och filerna i dess parametrar. */
export function workerResources(): string[] { return [...resources]; }

function remember(url: URL, params: string | null) {
  resources.add(url.pathname);
  if (!params) return;
  try {
    const parsed = JSON.parse(params) as unknown;
    const chunks = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] as unknown[] : [];
    for (const chunk of chunks) if (typeof chunk === "string") resources.add(new URL(chunk, url.origin).pathname);
  } catch { /* okända parametrar: bara skriptet sparas */ }
}

/** Skapar Workern med `create` (som anropar `new Worker(new URL(…))`); styrd av service workern när det finns en. */
export function controlledWorker(create: () => Worker): Worker {
  if (typeof window === "undefined") return create();
  const Original = window.Worker;
  const controlled = Boolean(navigator.serviceWorker?.controller);
  class Controlled extends Original {
    constructor(input: string | URL, options?: WorkerOptions) {
      const url = new URL(String(input), window.location.href);
      if (url.protocol === "blob:" || url.origin !== window.location.origin) { super(input, options); return; }
      const params = url.searchParams.get("params") ?? (url.hash.startsWith("#params=") ? decodeURIComponent(url.hash.slice(8)) : null);
      remember(url, params);
      if (!controlled || params === null) { super(input, options); return; }
      const script = new URL(url.pathname, url.origin).href;
      const bootstrap = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(script)});`], { type: "text/javascript" }));
      super(`${bootstrap}#params=${encodeURIComponent(params)}`, { ...options, type: "classic" });
      setTimeout(() => URL.revokeObjectURL(bootstrap), 60_000);
    }
  }
  window.Worker = Controlled;
  try { return create(); } finally { window.Worker = Original; }
}
