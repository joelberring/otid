import type { ReadoutPackage, ReadoutPlacement, ReadoutRegistrationRequest, ReadoutRegistrationResponse, ServerResultSummary,
  SportidentReadoutPayload } from "@o-tid/contracts";
import { inLanguage } from "../lib/in-language";

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
   * Steg 31: servern avvisade just den här avläsningen två gånger i rad med samma svar (översynen 2026-11-02: bara 400,
   * 404, 409 och 500). Den ligger kvar som väntande men hålls åt sidan så att resten av kön kan skickas; "Försök igen"
   * tar bort markeringen.
   */
  readonly serverFailedAt?: string;
  /**
   * Senaste svaret som gällde just den här avläsningen (400, 404, 409 eller 500). Utan `serverFailedAt` skickas den igen
   * nästa synk; kommer samma svar igen hålls den åt sidan.
   */
  readonly serverFailedStatus?: number;
}

/** Väntande avläsningar för en annan tävling, med tävlingens namn och datum om datorn har dess paket. */
export interface OtherRacePending {
  readonly raceId: string;
  readonly name?: string;
  readonly raceDate?: string;
  readonly readouts: readonly QueuedReadout[];
}

/** Grupperar väntande avläsningar (inte kvitterade) per tävling, utom `raceId`. */
export function groupPendingElsewhere(raceId: string, items: readonly QueuedReadout[],
  packages: readonly ReadoutPackage[]): OtherRacePending[] {
  const byRace = new Map<string, QueuedReadout[]>();
  for (const item of items) {
    if (item.raceId === raceId || item.status !== "pending") continue;
    byRace.set(item.raceId, [...(byRace.get(item.raceId) ?? []), item]);
  }
  return [...byRace].map(([id, readouts]) => {
    const pkg = packages.find(candidate => candidate.raceId === id);
    const race = pkg?.raceSnapshot.race;
    return { raceId: id, ...(pkg ? { name: [pkg.event.name, race?.name].filter(Boolean).join(" · "), raceDate: race?.raceDate ?? pkg.event.startsOn } : {}),
      readouts: [...readouts].sort((a, b) => a.localSequence - b.localSequence) };
  });
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
  /**
   * ADR-0187: avläsningar på den här datorn som inte har kommit fram till en ANNAN tävling (t.ex. den som återställdes från en
   * säkerhetskopia under ett nytt id). De skickas aldrig hit; avläsningssidan visar dem så att inget försvinner tyst.
   */
  pendingElsewhere(raceId: string): Promise<OtherRacePending[]>;
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
    value.onerror = () => reject(value.error ?? new Error(inLanguage("IndexedDB-fel", "Error in the browser's storage (IndexedDB)")));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB-transaktionen misslyckades"));
    transaction.onabort = () => reject(transaction.error ?? new Error(inLanguage("IndexedDB-transaktionen avbröts", "The browser's storage (IndexedDB) was interrupted")));
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
      open.onerror = () => reject(open.error ?? new Error(inLanguage("IndexedDB kunde inte öppnas", "The browser's storage (IndexedDB) could not be opened")));
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

  async pendingElsewhere(raceId: string): Promise<OtherRacePending[]> {
    const db = await this.#db;
    const tx = db.transaction(["readouts", "packages"]);
    const [items, packages] = await Promise.all([request(tx.objectStore("readouts").getAll()) as Promise<QueuedReadout[]>,
      request(tx.objectStore("packages").getAll()) as Promise<ReadoutPackage[]>]);
    return groupPendingElsewhere(raceId, items, packages);
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
