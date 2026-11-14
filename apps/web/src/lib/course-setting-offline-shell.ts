/**
 * Steg 67: banläggningens sidskal i telefonen (service workern `/course-setting-sw.js`). Scope är bara tävlingens
 * banläggning, `/admin/<tävling>/course-setting`, så avläsningen (`/readout/`, egen service worker) och alla andra sidor
 * berörs inte. Registreras först när banläggaren väljer "Spara för offline", och tas bort med "Ta bort från telefonen".
 */
import { workerResources } from "./course-setting-worker";
import { inLanguage } from "./in-language";

const scopeOf = (raceId: string) => `/admin/${encodeURIComponent(raceId)}/course-setting`;

export const shellSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;

/** Filerna sidan har laddat från Next (skript, stilar, typsnitt, Workerns filer) och sidan själv: dem behöver telefonen utan nät. */
function loadedUrls(raceId: string): string[] {
  return pageResources(scopeOf(raceId), workerResources());
}

/** Sidan och filerna under `/_next/static/` som den laddat (också för kartprojektets karta, K3). */
export function pageResources(page: string, extra: readonly string[] = []): string[] {
  const urls = new Set<string>([page, ...extra]);
  for (const entry of performance.getEntriesByType("resource")) {
    const url = new URL(entry.name, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.pathname + url.search);
  }
  return [...urls];
}

export function ask(worker: ServiceWorker, message: unknown, timeoutMs = 60_000): Promise<{ saved: number; failed: number }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error(inLanguage("Service workern svarade inte", "The service worker did not respond"))), timeoutMs);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data as { saved: number; failed: number }); };
    worker.postMessage(message, [channel.port2]);
  });
}

export async function activeWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (registration.active) return registration.active;
  const installing = registration.installing ?? registration.waiting;
  if (!installing) throw new Error("Ingen service worker");
  await new Promise<void>(resolve => {
    const check = () => { if (installing.state === "activated") { installing.removeEventListener("statechange", check); resolve(); } };
    installing.addEventListener("statechange", check);
    check();
  });
  return registration.active ?? installing;
}

/** Registrerar (eller uppdaterar) service workern och sparar sidan och filerna den laddat. */
export async function saveShell(raceId: string): Promise<{ saved: number; failed: number }> {
  if (!shellSupported()) throw new Error(inLanguage("Webbläsaren saknar service worker", "The browser has no service worker"));
  const registration = await navigator.serviceWorker.register("/course-setting-sw.js", { scope: scopeOf(raceId), updateViaCache: "none" });
  return ask(await activeWorker(registration), { type: "cache", urls: loadedUrls(raceId) });
}

/** Sidan är sparad för offline: håll service workern uppdaterad och spara de filer som laddats sedan sist. */
export async function refreshShell(raceId: string): Promise<void> {
  if (!shellSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(scopeOf(raceId));
  if (!registration) { await saveShell(raceId); return; }
  await registration.update().catch(() => undefined);
  if (registration.active) await ask(registration.active, { type: "cache", urls: loadedUrls(raceId) });
}

/** Tar bort tävlingens service worker och den sparade sidan (Nexts filer kan delas med andra tävlingar och ligger kvar). */
export async function removeShell(raceId: string): Promise<void> {
  if (!shellSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(scopeOf(raceId));
  if (registration && new URL(registration.scope).pathname.replace(/\/$/, "") === scopeOf(raceId)) await registration.unregister();
  if ("caches" in window) {
    const cache = await caches.open("otid-course-setting-v1");
    await cache.delete(`${window.location.origin}${scopeOf(raceId)}`);
    const left = await navigator.serviceWorker.getRegistrations();
    if (!left.some(row => /\/admin\/[^/]+\/course-setting$/.test(new URL(row.scope).pathname.replace(/\/$/, "")))) await caches.delete("otid-course-setting-v1");
  }
}

/** Alla tävlingars sparade sidor (utloggning). */
export async function removeAllShells(): Promise<void> {
  if (!shellSupported()) return;
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    if (/\/admin\/[^/]+\/course-setting$/.test(new URL(registration.scope).pathname.replace(/\/$/, ""))) await registration.unregister();
  }
  if ("caches" in window) await caches.delete("otid-course-setting-v1");
}
