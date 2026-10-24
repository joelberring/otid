import type { PartyDeskEventRequest, PartyGuestRequest } from "@o-tid/contracts";

/**
 * Bardiskens kö (PLAN.md steg 40): in- och utcheckningar och gästnamn sparas först här i webbläsaren och skickas sedan,
 * som avläsningarna och direktanmälningarna. Raderas aldrig; status ändras när servern kvitterat. Egen IndexedDB-databas,
 * så att avläsningskön inte behöver en ny version.
 */
export type PartyAction =
  | { readonly kind: "desk"; readonly request: PartyDeskEventRequest }
  | { readonly kind: "guest"; readonly request: PartyGuestRequest };

export interface QueuedPartyAction {
  readonly raceId: string;
  readonly requestId: string;
  readonly createdAt: string;
  readonly status: "pending" | "stored" | "rejected";
  readonly rejectedReason?: string;
  readonly action: PartyAction;
}

export interface PartyActionStore {
  add(item: QueuedPartyAction): Promise<void>;
  list(raceId: string): Promise<QueuedPartyAction[]>;
  update(item: QueuedPartyAction): Promise<void>;
}

const sorted = (rows: QueuedPartyAction[]) =>
  rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.requestId.localeCompare(right.requestId));

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB-fel"));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB-transaktionen misslyckades"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB-transaktionen avbröts"));
  });
}

export class IdbPartyActionStore implements PartyActionStore {
  readonly #db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.#db = new Promise((resolve, reject) => {
      const open = factory.open("otid-party", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("actions")) open.result.createObjectStore("actions", { keyPath: ["raceId", "requestId"] });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("IndexedDB kunde inte öppnas"));
    });
  }

  async add(item: QueuedPartyAction): Promise<void> {
    const tx = (await this.#db).transaction("actions", "readwrite");
    tx.objectStore("actions").add(item);
    await done(tx);
  }

  async list(raceId: string): Promise<QueuedPartyAction[]> {
    const range = IDBKeyRange.bound([raceId, ""], [raceId, "￿"]);
    return sorted(await request((await this.#db).transaction("actions").objectStore("actions").getAll(range)) as QueuedPartyAction[]);
  }

  async update(item: QueuedPartyAction): Promise<void> {
    const tx = (await this.#db).transaction("actions", "readwrite");
    tx.objectStore("actions").put(item);
    await done(tx);
  }
}

/** Endast för tester: samma regler i minnet. */
export class MemoryPartyActionStore implements PartyActionStore {
  readonly rows: QueuedPartyAction[] = [];
  async add(item: QueuedPartyAction) {
    if (this.rows.some(row => row.raceId === item.raceId && row.requestId === item.requestId)) throw new Error("Finns redan");
    this.rows.push(item);
  }
  async list(raceId: string) { return sorted(this.rows.filter(row => row.raceId === raceId)); }
  async update(item: QueuedPartyAction) {
    const index = this.rows.findIndex(row => row.raceId === item.raceId && row.requestId === item.requestId);
    if (index < 0) throw new Error("Finns inte");
    this.rows[index] = item;
  }
}
