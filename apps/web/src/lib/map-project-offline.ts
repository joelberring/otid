import type { MapProjectLayerView, MapProjectView } from "@o-tid/contracts";
import { activeWorker, ask, pageResources, shellSupported } from "./course-setting-offline-shell";
import { workerResources } from "./course-setting-worker";
import { inLanguage } from "./in-language";

/**
 * ADR-0219 tillägget om rekningen (K3): kartprojektets karta utan nät. Sidskalet sparas av service workern `/map-project-sw.js`
 * (samma som banläggningens, egen cache, scope bara projektets karta) när kartan öppnas med nät, och projektets uppgifter
 * (`MapProjectView`) sparas i IndexedDB. Kartfilen ligger redan i kartcachen och ändringarna och spåren i sina köer.
 * Utloggningen tar bort sidskalen och de sparade uppgifterna (`forgetMapProjectCopies`).
 */
const CACHE = "otid-map-project-v1";
const DB_NAME = "otid-map-project-views";
const STORE = "views";
const scopeOf = (projectId: string) => `/organizer/map-projects/${encodeURIComponent(projectId)}/map`;

/** Registrerar (eller uppdaterar) service workern och sparar sidan och filerna den laddat. Fel tystas inte: anroparen loggar. */
export async function saveMapProjectShell(projectId: string): Promise<void> {
  if (!shellSupported()) return;
  const registration = await navigator.serviceWorker.register("/map-project-sw.js", { scope: scopeOf(projectId), updateViaCache: "none" });
  await registration.update().catch(() => undefined);
  // Workerns skript och filer (startad med `controlledWorker`) följer med.
  await ask(await activeWorker(registration), { type: "cache", urls: pageResources(scopeOf(projectId), workerResources()) });
}

let opened: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("IndexedDB kunde inte öppnas", "The browser's storage (IndexedDB) could not be opened")));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}

/** Projektets uppgifter som de senast lästes, för kartan utan nät. */
export async function saveMapProjectView(view: MapProjectView): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ view, savedAt: new Date().toISOString() }, view.projectId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("Projektet kunde inte sparas", "The project could not be saved")));
  });
}

export async function savedMapProjectView(projectId: string): Promise<{ view: MapProjectView; savedAt: string } | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await open();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(projectId);
    request.onsuccess = () => resolve(request.result as { view: MapProjectView; savedAt: string } | undefined);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("Projektet kunde inte läsas", "The project could not be read")));
  });
}

/** K4a: listan över projektets underlag (bilderna ligger i kartcachen), under en egen nyckel i samma lager. */
const layersKey = (projectId: string) => `${projectId}:layers`;
export async function saveMapProjectLayers(projectId: string, layers: readonly MapProjectLayerView[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(layers, layersKey(projectId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("Underlagen kunde inte sparas", "The base layers could not be saved")));
  });
}

export async function savedMapProjectLayers(projectId: string): Promise<MapProjectLayerView[] | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await open();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(layersKey(projectId));
    request.onsuccess = () => resolve(request.result as MapProjectLayerView[] | undefined);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("Underlagen kunde inte läsas", "The base layers could not be read")));
  });
}

/** Ett projekt man inte längre är med i (404 eller 403 från servern): sidskalet och uppgifterna tas bort. */
export async function forgetMapProjectCopy(projectId: string): Promise<void> {
  if (typeof indexedDB !== "undefined") {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(projectId);
      transaction.objectStore(STORE).delete(layersKey(projectId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("Projektet kunde inte tas bort", "The project could not be removed")));
    });
  }
  if (!shellSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(scopeOf(projectId));
  if (registration && new URL(registration.scope).pathname.replace(/\/$/, "") === scopeOf(projectId)) await registration.unregister();
  if ("caches" in window) await (await caches.open(CACHE)).delete(`${window.location.origin}${scopeOf(projectId)}`);
}

/** Alla projekts sidskal och uppgifter (utloggning). */
export async function forgetMapProjectCopies(): Promise<void> {
  if (shellSupported()) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (/^\/organizer\/map-projects\/[^/]+\/map$/.test(new URL(registration.scope).pathname.replace(/\/$/, ""))) await registration.unregister();
    }
    if ("caches" in window) await caches.delete(CACHE);
  }
  if (typeof indexedDB === "undefined") return;
  if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some(row => row.name === DB_NAME)) return;
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("Projekten kunde inte tas bort", "The projects could not be removed")));
  });
}
