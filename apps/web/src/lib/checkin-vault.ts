import { z } from "zod";
import { canonicalStartCheckinOperation, StartCheckinOperationSchema, StartCheckinReceiptSchema,
  StartCheckinRosterResponseSchema, StartCheckinSyncRequestSchema, startCheckinDeviceRegistrationResponseSchema,
  type StartCheckinOperation, type StartCheckinReceipt, type StartCheckinRosterResponse,
  type StartCheckinDeviceRegistrationResponse, type StartCheckinSyncRequest } from "@o-tid/contracts";
import { createCheckinVaultSalt, decryptCheckinVaultValue, deriveCheckinVaultKey, encryptCheckinVaultValue,
  hashCheckinBytes } from "./checkin-vault-crypto";
import { checkinLocalView } from "./checkin-local-view";

export const CHECKIN_VAULT_DATABASE = "otid-checkin-vault-v1";
export const MAX_LOCAL_CHECKIN_OPERATIONS = 20_000;
const stores = ["headers", "rosters", "operations", "receipts"] as const;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const integer = z.number().int().nonnegative().max(2_147_483_647);
const envelope = z.object({ iv: z.string().regex(/^[0-9a-f]{24}$/), ciphertext: z.string().min(34).max(33_554_464).regex(/^(?:[0-9a-f]{2})+$/) }).strict();
const headerSchema = z.object({ formatVersion: z.literal(1), vaultId: uuid, deviceHash: z.string().regex(/^[0-9a-f]{64}$/),
  version: integer.positive(), salt: z.string().regex(/^[0-9a-f]{32}$/), encrypted: envelope }).strict();
const recordSchema = z.object({ vaultId: uuid, sequence: integer.positive(), encrypted: envelope }).strict();
const metaSchema = z.object({ formatVersion: z.literal(1), version: integer.positive(),
  registration: startCheckinDeviceRegistrationResponseSchema, preparedAt: z.iso.datetime({ precision: 3, offset: false }),
  nextSequence: z.number().int().min(1).max(MAX_LOCAL_CHECKIN_OPERATIONS + 1),
  lastReceiptSequence: z.number().int().min(0).max(MAX_LOCAL_CHECKIN_OPERATIONS), rosterVersion: integer.positive() }).strict();
type Header = z.infer<typeof headerSchema>;
type EncryptedRecord = z.infer<typeof recordSchema>;
type Meta = z.infer<typeof metaSchema>;
type Raw = { header: Header; roster: EncryptedRecord; operations: EncryptedRecord[]; receipts: EncryptedRecord[] };
export type LocalCheckinOperation = StartCheckinSyncRequest & { receipt: StartCheckinReceipt | null };
export type CheckinVaultSnapshot = { vaultId: string; version: number; preparedAt: string;
  registration: StartCheckinDeviceRegistrationResponse; roster: StartCheckinRosterResponse;
  nextSequence: number; lastReceiptSequence: number; operations: LocalCheckinOperation[] };

export class CheckinVaultError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "NOT_FOUND" | "INVALID_DATA" | "LOCKED" | "STALE_LOCAL_STATE" | "INVALID_OPERATION" | "INVALID_RECEIPT" | "REVIEW_REQUIRED" | "NOT_SAFE_TO_CLEAR" | "CAPACITY") {
    super("Local checkin storage operation failed"); this.name = "CheckinVaultError";
  }
}
function invalid(): never { throw new CheckinVaultError("INVALID_DATA"); }
function context(id: string, kind: string, version: number) { return `otid-checkin-v1:${id}:${kind}:${version}`; }
function range(id: string) { return IDBKeyRange.bound([id, 1], [id, 2_147_483_647]); }
function abortTransaction(transaction: IDBTransaction): void {
  try { transaction.abort(); }
  catch (error) {
    // A committed/aborted transaction may precede delivery of its terminal event.
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
  }
}

async function open(factory: IDBFactory): Promise<IDBDatabase> {
  if (!factory) throw new CheckinVaultError("UNAVAILABLE");
  return new Promise((resolve, reject) => {
    const request = factory.open(CHECKIN_VAULT_DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const headers = db.createObjectStore("headers", { keyPath: "vaultId" });
      headers.createIndex("deviceHash", "deviceHash", { unique: true });
      db.createObjectStore("rosters", { keyPath: "vaultId" });
      for (const name of ["operations", "receipts"]) db.createObjectStore(name, { keyPath: ["vaultId", "sequence"] });
    };
    request.onblocked = () => { failed = true; reject(new CheckinVaultError("UNAVAILABLE")); };
    request.onerror = () => reject(new CheckinVaultError("UNAVAILABLE"));
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function writeTransaction(db: IDBDatabase): IDBTransaction {
  const transaction = db.transaction([...stores], "readwrite", { durability: "strict" });
  if (transaction.durability !== "strict") { transaction.abort(); throw new CheckinVaultError("UNAVAILABLE"); }
  return transaction;
}
async function rawRead(db: IDBDatabase, vaultId: string): Promise<Raw> {
  uuid.parse(vaultId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...stores], "readonly");
    const header = tx.objectStore("headers").get(vaultId);
    const roster = tx.objectStore("rosters").get(vaultId);
    const operations = tx.objectStore("operations").getAll(range(vaultId), MAX_LOCAL_CHECKIN_OPERATIONS + 1);
    const receipts = tx.objectStore("receipts").getAll(range(vaultId), MAX_LOCAL_CHECKIN_OPERATIONS + 1);
    tx.onabort = () => reject(new CheckinVaultError("UNAVAILABLE"));
    tx.onerror = () => reject(new CheckinVaultError("UNAVAILABLE"));
    tx.oncomplete = () => {
      try {
        if (header.result === undefined) throw new CheckinVaultError("NOT_FOUND");
        const result = { header: headerSchema.parse(header.result), roster: recordSchema.parse(roster.result),
          operations: z.array(recordSchema).max(MAX_LOCAL_CHECKIN_OPERATIONS).parse(operations.result),
          receipts: z.array(recordSchema).max(MAX_LOCAL_CHECKIN_OPERATIONS).parse(receipts.result) };
        if (result.header.vaultId !== vaultId || result.roster.vaultId !== vaultId ||
          [...result.operations, ...result.receipts].some((row) => row.vaultId !== vaultId)) invalid();
        resolve(result);
      } catch (error) { reject(error instanceof CheckinVaultError ? error : new CheckinVaultError("INVALID_DATA")); }
    };
  });
}
function matchingReceipt(request: StartCheckinSyncRequest, receipt: StartCheckinReceipt): boolean {
  const operation = request.operation;
  return receipt.requestId === operation.requestId && receipt.deviceId === operation.deviceId && receipt.raceId === operation.raceId &&
    receipt.entryId === operation.entryId && receipt.localSequence === operation.localSequence && receipt.contentHash === request.contentHash &&
    (receipt.effect.kind !== "APPLIED" || receipt.effect.revision === operation.expectedRevision + 1) &&
    (receipt.effect.kind !== "UNCHANGED" || receipt.effect.revision === operation.expectedRevision);
}
function sameRegistrationRoster(registration: StartCheckinDeviceRegistrationResponse, roster: StartCheckinRosterResponse): boolean {
  const device = roster.devices.find((row) => row.deviceId === registration.deviceId);
  return registration.raceId === roster.raceId && device?.capability === registration.capability && device.label === registration.label;
}

export class CheckinVault {
  private key: CryptoKey | null;
  private readonly writes = new Set<IDBTransaction>();
  constructor(private readonly db: IDBDatabase, readonly vaultId: string, key: CryptoKey) { this.key = key; }
  lock(): void {
    this.key = null;
    for (const transaction of this.writes) abortTransaction(transaction);
    this.db.close();
  }
  private unlocked(): CryptoKey { if (!this.key) throw new CheckinVaultError("LOCKED"); return this.key; }
  private async decoded(): Promise<{ raw: Raw; meta: Meta; snapshot: CheckinVaultSnapshot }> {
    const key = this.unlocked(), raw = await rawRead(this.db, this.vaultId);
    const meta = metaSchema.parse(await decryptCheckinVaultValue(key, raw.header.encrypted, context(this.vaultId, "metadata", raw.header.version)));
    if (meta.version !== raw.header.version || meta.rosterVersion !== raw.roster.sequence ||
      raw.operations.length !== meta.nextSequence - 1 || raw.receipts.length !== meta.lastReceiptSequence ||
      meta.lastReceiptSequence >= meta.nextSequence) invalid();
    const expectedDeviceHash = await hashCheckinBytes(new TextEncoder().encode(meta.registration.deviceId));
    if (expectedDeviceHash !== raw.header.deviceHash) invalid();
    const roster = StartCheckinRosterResponseSchema.parse(await decryptCheckinVaultValue(key, raw.roster.encrypted, context(this.vaultId, "roster", meta.rosterVersion)));
    if (!sameRegistrationRoster(meta.registration, roster)) invalid();
    const operations: LocalCheckinOperation[] = [];
    const seenRequests = new Set<string>();
    for (const [index, row] of raw.operations.entries()) {
      if (row.sequence !== index + 1) invalid();
      const request = StartCheckinSyncRequestSchema.parse(await decryptCheckinVaultValue(key, row.encrypted, context(this.vaultId, "operation", row.sequence)));
      const operation = request.operation;
      if (operation.localSequence !== row.sequence || operation.raceId !== meta.registration.raceId ||
        operation.deviceId !== meta.registration.deviceId || operation.actorCredentialId !== meta.registration.actorCredentialId ||
        (operation.action.kind === "MARK_START" ? meta.registration.capability !== "START_CHECKIN" : meta.registration.capability !== "FINISH_FOREST_WATCH") ||
        seenRequests.has(operation.requestId) || request.contentHash !== await hashCheckinBytes(canonicalStartCheckinOperation(operation))) invalid();
      if (operation.dependsOnRequestId !== null && !operations.some((prior) => prior.operation.requestId === operation.dependsOnRequestId &&
        prior.operation.entryId === operation.entryId)) invalid();
      seenRequests.add(operation.requestId);
      let receipt: StartCheckinReceipt | null = null;
      if (index < raw.receipts.length) {
        const stored = raw.receipts[index]!;
        if (stored.sequence !== row.sequence) invalid();
        receipt = StartCheckinReceiptSchema.parse(await decryptCheckinVaultValue(key, stored.encrypted, context(this.vaultId, "receipt", row.sequence)));
        if (!matchingReceipt(request, receipt)) invalid();
      }
      operations.push({ ...request, receipt });
    }
    this.unlocked();
    return { raw, meta, snapshot: { vaultId: this.vaultId, version: meta.version, preparedAt: meta.preparedAt,
      registration: meta.registration, roster, nextSequence: meta.nextSequence, lastReceiptSequence: meta.lastReceiptSequence, operations } };
  }
  async read(): Promise<CheckinVaultSnapshot> { return (await this.decoded()).snapshot; }
  private async commit(raw: Raw, metadata: Meta | null, edit: (tx: IDBTransaction) => void): Promise<void> {
    const key = this.unlocked();
    const nextHeader = metadata === null ? null : { ...raw.header, version: metadata.version,
      encrypted: await encryptCheckinVaultValue(key, metaSchema.parse(metadata), context(this.vaultId, "metadata", metadata.version)) };
    this.unlocked();
    await new Promise<void>((resolve, reject) => {
      const tx = writeTransaction(this.db); this.writes.add(tx);
      let failure: CheckinVaultError | undefined;
      const current = tx.objectStore("headers").get(this.vaultId);
      current.onsuccess = () => {
        try {
          const parsed = headerSchema.safeParse(current.result);
          if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(raw.header)) {
            failure = new CheckinVaultError("STALE_LOCAL_STATE"); abortTransaction(tx); return;
          }
          this.unlocked(); edit(tx);
          if (nextHeader) tx.objectStore("headers").put(nextHeader);
          else tx.objectStore("headers").delete(this.vaultId);
        } catch (error) { failure = error instanceof CheckinVaultError ? error : new CheckinVaultError("UNAVAILABLE"); abortTransaction(tx); }
      };
      tx.onabort = () => { this.writes.delete(tx); reject(failure ?? new CheckinVaultError("UNAVAILABLE")); };
      tx.onerror = () => { failure ??= new CheckinVaultError("UNAVAILABLE"); };
      tx.oncomplete = () => { this.writes.delete(tx); resolve(); };
    });
    this.unlocked();
  }
  async enqueueAction(expectedVersion: number, input: { requestId: string; entryId: string; observedAt: string; action: StartCheckinOperation["action"] }): Promise<CheckinVaultSnapshot> {
    const { raw, meta, snapshot } = await this.decoded();
    if (expectedVersion !== meta.version) throw new CheckinVaultError("STALE_LOCAL_STATE");
    if (meta.nextSequence > MAX_LOCAL_CHECKIN_OPERATIONS || meta.version >= 2_147_483_647) throw new CheckinVaultError("CAPACITY");
    const entry = snapshot.roster.entries.find((row) => row.entryId === input.entryId);
    if (!entry || snapshot.operations.some((row) => row.operation.requestId === input.requestId) ||
      (input.action.kind === "MARK_START" ? meta.registration.capability !== "START_CHECKIN" : meta.registration.capability !== "FINISH_FOREST_WATCH")) throw new CheckinVaultError("INVALID_OPERATION");
    const { revision: expectedRevision, state, manualReturnRegistered: manualReturn, dependsOnRequestId, conflicts } = checkinLocalView(entry, snapshot.operations);
    if (conflicts > 0) throw new CheckinVaultError("REVIEW_REQUIRED");
    if (input.action.state === state && (input.action.kind === "MARK_START" || input.action.manualReturnRegistered === manualReturn)) throw new CheckinVaultError("INVALID_OPERATION");
    const operation = StartCheckinOperationSchema.parse({ formatVersion: 1, ...input, deviceId: meta.registration.deviceId,
      actorCredentialId: meta.registration.actorCredentialId, raceId: meta.registration.raceId, localSequence: meta.nextSequence,
      packageVersion: snapshot.roster.snapshotVersion, expectedEntryVersion: entry.entryVersion, expectedRevision,
      dependsOnRequestId });
    const request = { operation, contentHash: await hashCheckinBytes(canonicalStartCheckinOperation(operation)) };
    const encrypted = await encryptCheckinVaultValue(this.unlocked(), request, context(this.vaultId, "operation", operation.localSequence));
    await this.commit(raw, { ...meta, version: meta.version + 1, nextSequence: meta.nextSequence + 1 }, (tx) => {
      tx.objectStore("operations").add({ vaultId: this.vaultId, sequence: operation.localSequence, encrypted });
    });
    return this.read();
  }
  async applyReceipt(expectedVersion: number, value: unknown): Promise<CheckinVaultSnapshot> {
    const receipt = StartCheckinReceiptSchema.parse(value), { raw, meta, snapshot } = await this.decoded();
    const target = snapshot.operations[receipt.localSequence - 1];
    if (!target || !matchingReceipt(target, receipt)) throw new CheckinVaultError("INVALID_RECEIPT");
    if (target.receipt) {
      if (JSON.stringify(target.receipt) !== JSON.stringify(receipt)) throw new CheckinVaultError("INVALID_RECEIPT");
      return snapshot;
    }
    if (meta.version !== expectedVersion) throw new CheckinVaultError("STALE_LOCAL_STATE");
    if (receipt.localSequence !== meta.lastReceiptSequence + 1) throw new CheckinVaultError("INVALID_RECEIPT");
    const encrypted = await encryptCheckinVaultValue(this.unlocked(), receipt, context(this.vaultId, "receipt", receipt.localSequence));
    await this.commit(raw, { ...meta, version: meta.version + 1, lastReceiptSequence: receipt.localSequence }, (tx) => {
      tx.objectStore("receipts").add({ vaultId: this.vaultId, sequence: receipt.localSequence, encrypted });
    });
    return this.read();
  }
  async replaceRoster(expectedVersion: number, value: unknown): Promise<CheckinVaultSnapshot> {
    const roster = StartCheckinRosterResponseSchema.parse(value), { raw, meta, snapshot } = await this.decoded();
    if (meta.version !== expectedVersion) throw new CheckinVaultError("STALE_LOCAL_STATE");
    if (!sameRegistrationRoster(meta.registration, roster) || roster.snapshotVersion < snapshot.roster.snapshotVersion ||
      roster.generatedAt < snapshot.roster.generatedAt || roster.devices.find((row) => row.deviceId === meta.registration.deviceId)!.lastSequence >= meta.nextSequence ||
      roster.entries.some((entry) => entry.revision < (snapshot.roster.entries.find((old) => old.entryId === entry.entryId)?.revision ?? 0))) invalid();
    const rosterVersion = meta.rosterVersion + 1;
    const encrypted = await encryptCheckinVaultValue(this.unlocked(), roster, context(this.vaultId, "roster", rosterVersion));
    await this.commit(raw, { ...meta, version: meta.version + 1, rosterVersion }, (tx) => {
      tx.objectStore("rosters").put({ vaultId: this.vaultId, sequence: rosterVersion, encrypted });
    });
    return this.read();
  }
  async clear(expectedVersion: number): Promise<void> {
    const { raw, meta, snapshot } = await this.decoded();
    if (meta.version !== expectedVersion) throw new CheckinVaultError("STALE_LOCAL_STATE");
    if (snapshot.operations.some((row) => row.receipt === null) || snapshot.roster.entries.some(entry =>
      entry.conflictingReports || checkinLocalView(entry, snapshot.operations).conflicts > 0)) throw new CheckinVaultError("NOT_SAFE_TO_CLEAR");
    await this.commit(raw, null, (tx) => {
      tx.objectStore("rosters").delete(this.vaultId);
      tx.objectStore("operations").delete(range(this.vaultId)); tx.objectStore("receipts").delete(range(this.vaultId));
    });
    this.lock();
  }
}

export async function createCheckinVault(input: { vaultId: string; passphrase: string; registration: unknown; roster: unknown; preparedAt: string }, factory: IDBFactory = globalThis.indexedDB): Promise<CheckinVault> {
  const vaultId = uuid.parse(input.vaultId), registration = startCheckinDeviceRegistrationResponseSchema.parse(input.registration);
  const roster = StartCheckinRosterResponseSchema.parse(input.roster);
  if (!sameRegistrationRoster(registration, roster) || roster.devices.find((row) => row.deviceId === registration.deviceId)!.lastSequence !== 0) invalid();
  const salt = createCheckinVaultSalt(), key = await deriveCheckinVaultKey(input.passphrase, salt);
  const meta = metaSchema.parse({ formatVersion: 1, version: 1, registration, preparedAt: input.preparedAt, nextSequence: 1, lastReceiptSequence: 0, rosterVersion: 1 });
  const header: Header = { formatVersion: 1, vaultId, version: 1, salt,
    deviceHash: await hashCheckinBytes(new TextEncoder().encode(registration.deviceId)),
    encrypted: await encryptCheckinVaultValue(key, meta, context(vaultId, "metadata", 1)) };
  const encryptedRoster: EncryptedRecord = { vaultId, sequence: 1, encrypted: await encryptCheckinVaultValue(key, roster, context(vaultId, "roster", 1)) };
  const db = await open(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = writeTransaction(db);
      tx.objectStore("headers").add(header); tx.objectStore("rosters").add(encryptedRoster);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(new CheckinVaultError("UNAVAILABLE"));
      tx.onerror = () => reject(new CheckinVaultError("UNAVAILABLE"));
    });
    const result = new CheckinVault(db, vaultId, key);
    await result.read(); return result;
  } catch (error) { db.close(); throw error; }
}
export async function unlockCheckinVault(vaultId: string, passphrase: string, factory: IDBFactory = globalThis.indexedDB): Promise<CheckinVault> {
  uuid.parse(vaultId); const db = await open(factory);
  try {
    const raw = await rawRead(db, vaultId), key = await deriveCheckinVaultKey(passphrase, raw.header.salt);
    const result = new CheckinVault(db, vaultId, key); await result.read(); return result;
  } catch (error) { db.close(); throw error; }
}
export async function listCheckinVaultIds(factory: IDBFactory = globalThis.indexedDB): Promise<string[]> {
  const db = await open(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("headers", "readonly"), request = tx.objectStore("headers").getAllKeys();
      tx.oncomplete = () => { try { resolve(z.array(uuid).parse(request.result)); } catch { reject(new CheckinVaultError("INVALID_DATA")); } };
      tx.onabort = () => reject(new CheckinVaultError("UNAVAILABLE")); tx.onerror = () => reject(new CheckinVaultError("UNAVAILABLE"));
    });
  } finally { db.close(); }
}
export async function exportCheckinVaultArchive(vaultId: string, factory: IDBFactory = globalThis.indexedDB): Promise<string> {
  const db = await open(factory);
  try { return JSON.stringify({ formatVersion: 1, kind: "OTID_CHECKIN_ENCRYPTED_ARCHIVE", ...await rawRead(db, vaultId) }); }
  finally { db.close(); }
}

/** Invoke only from explicit preparation. A false result must remain visible to the operator. */
export async function requestCheckinPersistentStorage(storage: StorageManager = navigator.storage): Promise<boolean> {
  if (!storage || typeof storage.persist !== "function" || typeof storage.persisted !== "function") throw new CheckinVaultError("UNAVAILABLE");
  await storage.persist();
  return storage.persisted();
}
