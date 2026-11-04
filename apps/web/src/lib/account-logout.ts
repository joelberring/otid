import { forgetAllCourseSettingCopies, fieldStore } from "./course-setting-offline-forget";
import { readOrganizerCsrf } from "./organizer-client";
import { FOLLOW_STORAGE_KEY } from "./follow-store";

/**
 * ADR-0205 tillägg: utloggningen från kontomenyn (alla inloggade sidor) och "Logga ut från alla enheter" under Mitt konto.
 * Ägaren loggar ut på klubbens och tävlingens lånade datorer, så utloggningen tar också bort det som webbläsaren sparat om
 * tävlingar och personer:
 *
 * - banläggningens kopia i telefonen (posten, kön, kartfilen och den sparade sidan i service workerns cache),
 * - inbjudan som väntar, den påbörjade tävlingen, följda löpare och klubbar, självregistreringens ifyllda namn och
 *   flikarnas tillfälliga val (`sessionStorage` med `otid`),
 *
 * men aldrig avläsningarnas och festens köer (`otid-readout`, `otid-party`): råa avläsningar sparas alltid och en kö tas bara
 * bort när servern har kvitterat (AGENTS.md). Ändringar som väntar på nät räknas först; finns det några frågar menyn
 * "N ändringar väntar på nät – logga ut ändå?". Banläggningens väntande ändringar försvinner då; avläsningarna står kvar.
 */
export interface PendingOfflineChanges { courseSetting: number; readouts: number; party: number; total: number }

/** Databasen finns redan (öppnas inte, och skapas alltså inte, annars). Utan `databases()` antas den finnas. */
async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases !== "function") return true;
  try { return (await indexedDB.databases()).some(row => row.name === name); } catch { return true; }
}

/** Antal poster med `status: "pending"` i databasens lager, eller 0 om databasen eller lagret saknas. */
async function countPending(name: string, stores: readonly string[]): Promise<number> {
  if (!await databaseExists(name)) return 0;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB kunde inte öppnas"));
  });
  try {
    let total = 0;
    for (const store of stores.filter(store => db.objectStoreNames.contains(store))) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB-fel"));
      });
      total += rows.filter(row => (row as { status?: unknown }).status === "pending").length;
    }
    return total;
  } finally { db.close(); }
}

/** Avläsningar som inte kunde skickas (sparade per tävling i `localStorage`). */
function failedReadouts(): number {
  let total = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith("otid-readout-failed:")) continue;
      const rows: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      if (Array.isArray(rows)) total += rows.length;
    }
  } catch { /* utan lagring finns inget sparat */ }
  return total;
}

export async function pendingOfflineChanges(): Promise<PendingOfflineChanges> {
  const safe = async (count: () => Promise<number>) => { try { return await count(); } catch (error) { console.error("Kön kunde inte läsas", error); return 0; } };
  const courseSetting = await safe(() => fieldStore().pendingCount());
  const readouts = await safe(() => countPending("otid-readout", ["readouts", "registrations"])) + failedReadouts();
  const party = await safe(() => countPending("otid-party", ["actions"]));
  return { courseSetting, readouts, party, total: courseSetting + readouts + party };
}

/** Nycklar i `localStorage` med tävlings- eller persondata (inte inställningar som ljud, kvitto eller panelens bredd). */
const PERSONAL_KEYS = [FOLLOW_STORAGE_KEY, "otid.inbjudan"];
const PERSONAL_PREFIXES = ["otid-grupp-anmalan:"];

/** Tar bort det som webbläsaren sparat om tävlingar och personer (se ovan). Kastar inte; fel skrivs i konsolen. */
export async function clearPersonalBrowserData(): Promise<void> {
  await forgetAllCourseSettingCopies().catch(error => console.error("Banläggningen i webbläsaren kunde inte tas bort", error));
  try {
    const local = window.localStorage;
    const keys = Array.from({ length: local.length }, (_, index) => local.key(index)).filter((key): key is string => key !== null);
    for (const key of keys) if (PERSONAL_KEYS.includes(key) || PERSONAL_PREFIXES.some(prefix => key.startsWith(prefix))) local.removeItem(key);
  } catch { /* utan lagring finns inget sparat */ }
  try {
    const session = window.sessionStorage;
    const keys = Array.from({ length: session.length }, (_, index) => session.key(index)).filter((key): key is string => key !== null);
    for (const key of keys) if (key.startsWith("otid")) session.removeItem(key);
  } catch { /* utan lagring finns inget sparat */ }
}

/** Inloggningssidan efter utloggningen: "Du är utloggad" (eller "från alla enheter"). */
export const LOGGED_OUT_PATH = "/organizer?utloggad=1";
export const LOGGED_OUT_EVERYWHERE_PATH = "/organizer?utloggad=alla";

/**
 * Loggar ut: servern spärrar sessionen (`/api/organizer/logout`, eller alla med `everywhere`), webbläsarens data tas bort och
 * sidan går till inloggningen. 401 betyder att sessionen redan var slut; det räknas som utloggad.
 */
export async function logOut(options: { everywhere?: boolean } = {}): Promise<{ ok: true } | { ok: false; status: number }> {
  let csrf = "";
  try { csrf = readOrganizerCsrf(document.cookie, new URL(window.location.href)); } catch { csrf = ""; }
  if (csrf) {
    const response = await fetch(options.everywhere ? "/api/account/logout-all" : "/api/organizer/logout",
      { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "x-otid-csrf": csrf } });
    if (!response.ok && response.status !== 401) return { ok: false, status: response.status };
  }
  await clearPersonalBrowserData();
  window.location.assign(options.everywhere ? LOGGED_OUT_EVERYWHERE_PATH : LOGGED_OUT_PATH);
  return { ok: true };
}
