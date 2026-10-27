import type { ReadoutPackage, ReadoutPlacement, ReadoutRegistrationRequest, ReadoutRegistrationResponse, ServerResultSummary,
  SportidentReadoutPayload } from "@o-tid/contracts";

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
  /** Steg 57: placeringen när servern kvitterade avläsningen (preliminär, för de som då var godkända). */
  readonly placement?: ReadoutPlacement;
  readonly rejectedReason?: string;
  /**
   * Steg 31: servern svarade med ett serverfel (5xx) för just den här avläsningen. Den ligger kvar som väntande men
   * hålls åt sidan så att resten av kön kan skickas; "Försök igen" tar bort markeringen.
   */
  readonly serverFailedAt?: string;
  /** Steg 45: serverns svarskod när avläsningen hölls åt sidan (5xx, 400, 404 eller 409). */
  readonly serverFailedStatus?: number;
}

export type NewReadout = Omit<QueuedReadout, "raceId" | "deviceId" | "sessionId" | "localSequence" | "status">;

/**
 * Direktanmälan av en okänd bricka (PLAN.md steg 25) eller koppling av brickan till en anmäld deltagare (steg 29), köad
 * som avläsningarna. Raderas aldrig; status ändras när servern
 * kvitterat (stored) eller avvisat (rejected). Skickas före avläsningarna.
 */
export interface QueuedRegistration {
  readonly raceId: string;
  readonly requestId: string;
  readonly request: ReadoutRegistrationRequest;
  /** Avläsningen som anmälan gjordes för. */
  readonly localSequence: number;
  readonly createdAt: string;
  readonly status: "pending" | "stored" | "rejected";
  readonly response?: ReadoutRegistrationResponse;
  readonly rejectedReason?: string;
  /** Koppling till en anmäld deltagare (PLAN.md steg 29): namnet och klassen som visas tills servern svarat. */
  readonly display?: { readonly entryName: string; readonly className: string };
}

export interface ReadoutStore {
  loadPackage(raceId: string): Promise<ReadoutPackage | undefined>;
  savePackage(value: ReadoutPackage): Promise<void>;
  /** Stabilt enhets-id och sessions-id per webbläsare och lopp. */
  identity(raceId: string): Promise<{ deviceId: string; sessionId: string }>;
  /** Lägger till en avläsning med nästa löpnummer, atomiskt. */
  append(raceId: string, item: NewReadout): Promise<QueuedReadout>;
  list(raceId: string): Promise<QueuedReadout[]>;
  update(item: QueuedReadout): Promise<void>;
  /** Direktanmälningar (PLAN.md steg 25). `addRegistration` lägger till; en befintlig begäran skrivs aldrig över. */
  addRegistration(item: QueuedRegistration): Promise<void>;
  listRegistrations(raceId: string): Promise<QueuedRegistration[]>;
  updateRegistration(item: QueuedRegistration): Promise<void>;
}

const DB_NAME = "otid-readout";
/** Version 2 (PLAN.md steg 25): kön för direktanmälningar. */
const DB_VERSION = 2;

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
        // Uppgradering från version 1 behåller avläsningarna och lägger bara till det som saknas.
        if (!db.objectStoreNames.contains("packages")) db.createObjectStore("packages", { keyPath: "raceId" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("readouts")) db.createObjectStore("readouts", { keyPath: ["raceId", "localSequence"] });
        if (!db.objectStoreNames.contains("registrations")) db.createObjectStore("registrations", { keyPath: ["raceId", "requestId"] });
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

  async addRegistration(item: QueuedRegistration): Promise<void> {
    const db = await this.#db;
    const tx = db.transaction("registrations", "readwrite");
    tx.objectStore("registrations").add(item);
    await done(tx);
  }

  async listRegistrations(raceId: string): Promise<QueuedRegistration[]> {
    const db = await this.#db;
    const range = IDBKeyRange.bound([raceId, ""], [raceId, "\uffff"]);
    const rows = await request(db.transaction("registrations").objectStore("registrations").getAll(range)) as QueuedRegistration[];
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.requestId.localeCompare(right.requestId));
  }

  async updateRegistration(item: QueuedRegistration): Promise<void> {
    const db = await this.#db;
    const tx = db.transaction("registrations", "readwrite");
    tx.objectStore("registrations").put(item);
    await done(tx);
  }
}
