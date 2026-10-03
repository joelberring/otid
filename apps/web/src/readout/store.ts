import type { ReadoutPackage, ServerResultSummary, SportidentReadoutPayload } from "@o-tid/contracts";

export type QueueStatus = "pending" | "stored" | "duplicate" | "rejected";

/** En avläsning i den lokala kön. Raderas aldrig; status ändras när servern kvitterat. */
export interface QueuedReadout {
  readonly raceId: string;
  readonly deviceId: string;
  readonly localSequence: number;
  /** Paketversion och session när avläsningen gjordes; skickas alltid oförändrade. */
  readonly packageVersion: number;
  readonly sessionId: string;
  readonly stationReceivedAt: string;
  readonly payload: SportidentReadoutPayload;
  readonly contentHash: string;
  readonly status: QueueStatus;
  readonly serverResult?: ServerResultSummary;
  readonly rejectedReason?: string;
}

export type NewReadout = Omit<QueuedReadout, "raceId" | "deviceId" | "sessionId" | "localSequence" | "status">;

export interface ReadoutStore {
  loadPackage(raceId: string): Promise<ReadoutPackage | undefined>;
  savePackage(value: ReadoutPackage): Promise<void>;
  /** Stabilt enhets-id och sessions-id per webbläsare och lopp. */
  identity(raceId: string): Promise<{ deviceId: string; sessionId: string }>;
  /** Lägger till en avläsning med nästa löpnummer, atomiskt. */
  append(raceId: string, item: NewReadout): Promise<QueuedReadout>;
  list(raceId: string): Promise<QueuedReadout[]>;
  update(item: QueuedReadout): Promise<void>;
}

const DB_NAME = "otid-readout";
const DB_VERSION = 1;

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

/** Beständig kö i webbläsarens IndexedDB. Tål omladdning och nätavbrott. */
export class IdbReadoutStore implements ReadoutStore {
  readonly #db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.#db = new Promise((resolve, reject) => {
      const open = factory.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("packages", { keyPath: "raceId" });
        db.createObjectStore("meta");
        db.createObjectStore("readouts", { keyPath: ["raceId", "localSequence"] });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("IndexedDB kunde inte öppnas"));
    });
  }

  async loadPackage(raceId: string): Promise<ReadoutPackage | undefined> {
    const db = await this.#db;
    return await request(db.transaction("packages").objectStore("packages").get(raceId)) as ReadoutPackage | undefined;
  }

  async savePackage(value: ReadoutPackage): Promise<void> {
    const db = await this.#db;
    const tx = db.transaction("packages", "readwrite");
    tx.objectStore("packages").put(value);
    await done(tx);
  }

  async identity(raceId: string): Promise<{ deviceId: string; sessionId: string }> {
    const db = await this.#db;
    const tx = db.transaction("meta", "readwrite");
    const meta = tx.objectStore("meta");
    const key = `identity:${raceId}`;
    let value = await request(meta.get(key)) as { deviceId: string; sessionId: string } | undefined;
    if (!value) {
      value = { deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
      meta.put(value, key);
    }
    await done(tx);
    return value;
  }

  async append(raceId: string, item: NewReadout): Promise<QueuedReadout> {
    const { deviceId, sessionId } = await this.identity(raceId);
    const db = await this.#db;
    const tx = db.transaction(["meta", "readouts"], "readwrite");
    const meta = tx.objectStore("meta");
    const key = `sequence:${raceId}`;
    const previous = (await request(meta.get(key)) as number | undefined) ?? 0;
    const stored: QueuedReadout = { ...item, raceId, deviceId, sessionId, localSequence: previous + 1, status: "pending" };
    meta.put(stored.localSequence, key);
    tx.objectStore("readouts").add(stored);
    await done(tx);
    return stored;
  }

  async list(raceId: string): Promise<QueuedReadout[]> {
    const db = await this.#db;
    const range = IDBKeyRange.bound([raceId, 0], [raceId, Number.MAX_SAFE_INTEGER]);
    return await request(db.transaction("readouts").objectStore("readouts").getAll(range)) as QueuedReadout[];
  }

  async update(item: QueuedReadout): Promise<void> {
    const db = await this.#db;
    const tx = db.transaction("readouts", "readwrite");
    tx.objectStore("readouts").put(item);
    await done(tx);
  }
}
