import { emptyClientState, type RevisionClientState } from "@o-tid/map-revision";
import { inLanguage } from "./in-language";

/**
 * ADR-0219 beslut 4 (K1): kartprojektets egna ändringar i webbläsaren (IndexedDB), per projekt och konto. Kön (`pending`) tas
 * bort först när servern kvitterat (AGENTS.md); sidan sparar hela läget efter varje ändring och varje svar. Saknas IndexedDB
 * (privat läge i vissa webbläsare) finns läget bara i minnet och sidan säger det.
 */
const DB_NAME = "otid-map-projects";
const STORE = "clients";

export interface StoredClient {
  readonly state: RevisionClientState;
  /** Den här webbläsarens id i synken (en per projekt och konto). */
  readonly clientId: string;
}

let opened: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const value = indexedDB.open(DB_NAME, 1);
    value.onupgradeneeded = () => { value.result.createObjectStore(STORE); };
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error(inLanguage("IndexedDB kunde inte öppnas", "The browser's storage (IndexedDB) could not be opened")));
    value.onblocked = () => reject(new Error(inLanguage("IndexedDB är blockerad av en annan flik", "The browser's storage (IndexedDB) is blocked by another tab")));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}

const storeKey = (projectId: string, accountId: string) => `${projectId}:${accountId}`;

export const clientStoreAvailable = () => typeof indexedDB !== "undefined";

/** Läget som sparats, eller ett tomt med nytt id. */
export async function loadClient(projectId: string, accountId: string): Promise<StoredClient> {
  const fresh = (): StoredClient => ({ state: emptyClientState(), clientId: crypto.randomUUID() });
  if (!clientStoreAvailable()) return fresh();
  const database = await open();
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(storeKey(projectId, accountId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("IndexedDB-fel", "Error in the browser's storage (IndexedDB)")));
  });
  const value = stored as Partial<StoredClient> | undefined;
  if (!value?.state || typeof value.clientId !== "string") return fresh();
  // Äldre sparade lägen saknar fält som tillkommit: tomma i stället.
  return { clientId: value.clientId, state: { ...emptyClientState(), ...value.state } };
}

export async function saveClient(projectId: string, accountId: string, client: StoredClient): Promise<void> {
  if (!clientStoreAvailable()) return;
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(client, storeKey(projectId, accountId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("IndexedDB-fel", "Error in the browser's storage (IndexedDB)")));
    transaction.onabort = () => reject(transaction.error ?? new Error(inLanguage("IndexedDB avbröts", "The browser's storage (IndexedDB) was interrupted")));
  });
}
