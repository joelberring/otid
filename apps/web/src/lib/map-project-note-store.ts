/**
 * ADR-0219 (K3): notiser i kartprojektet som väntar på servern (IndexedDB). En notis skrivs i telefonen (gärna utan nät) och
 * tas bort ur telefonen först när servern har kvitterat den (AGENTS.md); samma notis två gånger blir en (id:t från telefonen).
 * Utloggningen räknar och tar bort dem (`account-logout.ts`). Saknas IndexedDB finns de bara i minnet.
 */
const DB_NAME = "otid-map-project-notes";
const STORE = "notes";

export interface LocalNote {
  readonly noteId: string;
  readonly projectId: string;
  readonly accountId: string;
  /** Kroppen till servern (`mapProjectNoteCreateRequestSchema`). */
  readonly request: {
    readonly formatVersion: 1; readonly noteId: string; readonly at: { readonly x: number; readonly y: number }; readonly objectKey?: string | null;
    readonly text: string; readonly photo?: { readonly mediaType: "image/jpeg"; readonly base64: string } | null;
  };
  readonly createdAt: string;
  /** Senaste felet från servern (visas vid notisen). */
  readonly problem?: number | undefined;
}

const memory = new Map<string, LocalNote>();
const available = () => typeof indexedDB !== "undefined";

let opened: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "noteId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB kunde inte öppnas"));
    request.onblocked = () => reject(new Error("IndexedDB är blockerad av en annan flik"));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}

async function write(action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Notisen kunde inte sparas"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Notisen kunde inte sparas"));
  });
}

export async function localNotes(projectId: string, accountId: string): Promise<LocalNote[]> {
  const mine = (note: LocalNote) => note.projectId === projectId && note.accountId === accountId;
  if (!available()) return [...memory.values()].filter(mine);
  const database = await open();
  const all = await new Promise<LocalNote[]>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as LocalNote[]);
    request.onerror = () => reject(request.error ?? new Error("Notiserna kunde inte läsas"));
  });
  return all.filter(mine).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putLocalNote(note: LocalNote): Promise<void> {
  if (!available()) { memory.set(note.noteId, note); return; }
  await write(store => store.put(note));
}

/** Bara när servern kvitterat notisen, eller när personen tar bort den. */
export async function deleteLocalNote(noteId: string): Promise<void> {
  if (!available()) { memory.delete(noteId); return; }
  await write(store => store.delete(noteId));
}

const exists = async () => typeof indexedDB.databases !== "function" || (await indexedDB.databases()).some(row => row.name === DB_NAME);

/** Notiserna som väntar (alla projekt och konton i webbläsaren), för utloggningens fråga. */
export async function pendingNoteCount(): Promise<number> {
  if (!available()) return memory.size;
  if (!await exists()) return 0;
  const database = await open();
  return new Promise<number>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Notiserna kunde inte räknas"));
  });
}

/** Allt i telefonen (utloggning). */
export async function clearLocalNotes(): Promise<void> {
  memory.clear();
  if (!available() || !await exists()) return;
  await write(store => store.clear());
}
