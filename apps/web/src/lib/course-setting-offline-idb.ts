import type { FieldRecord, FieldStore, QueuedItem, StoredMapInfo } from "./course-setting-offline";

/**
 * Steg 67: banläggningens lager i telefonen (IndexedDB `otid-course-setting`, skilt från avläsningens `otid-readout`).
 * - `record`: editorns väntande åtgärder och versionen de bygger på, per tävling.
 * - `queue`: notiser och bockar i ordning (löpnummer som nyckel).
 * - `mapInfo` och `mapData`: kartfilen (5–60 MB) i två delar, så att storleken kan visas utan att filen läses.
 */
const DB_NAME = "otid-course-setting";
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
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB-fel"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB avbröts"));
  });
}

let opened: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const value = indexedDB.open(DB_NAME, DB_VERSION);
    value.onupgradeneeded = () => {
      const db = value.result;
      if (!db.objectStoreNames.contains("record")) db.createObjectStore("record", { keyPath: "raceId" });
      if (!db.objectStoreNames.contains("queue")) {
        const queue = db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
        queue.createIndex("raceId", "raceId");
        queue.createIndex("id", "id", { unique: true });
      }
      if (!db.objectStoreNames.contains("mapInfo")) db.createObjectStore("mapInfo", { keyPath: "raceId" });
      if (!db.objectStoreNames.contains("mapData")) db.createObjectStore("mapData", { keyPath: "raceId" });
    };
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB kunde inte öppnas"));
    value.onblocked = () => reject(new Error("IndexedDB är blockerad av en annan flik"));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}

async function read<T>(name: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return await request(db.transaction(name).objectStore(name).get(key)) as T | undefined;
}

async function write(names: string[], change: (transaction: IDBTransaction) => void): Promise<void> {
  const db = await open();
  const transaction = db.transaction(names, "readwrite");
  change(transaction);
  await done(transaction);
}

/** IndexedDB, eller undefined där den saknas (servern, mycket gamla webbläsare). */
export function indexedDbFieldStore(): FieldStore | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  return {
    readRecord: raceId => read<FieldRecord>("record", raceId),
    writeRecord: record => write(["record"], transaction => { transaction.objectStore("record").put(record); }),
    clearRecord: raceId => write(["record"], transaction => { transaction.objectStore("record").delete(raceId); }),
    listQueue: async raceId => {
      const db = await open();
      const rows = await request(db.transaction("queue").objectStore("queue").index("raceId").getAll(raceId)) as (QueuedItem & { seq: number })[];
      return rows.sort((a, b) => a.seq - b.seq).map(row => {
        const item: Partial<typeof row> = { ...row };
        delete item.seq;
        return item as QueuedItem;
      });
    },
    addQueued: async item => {
      const db = await open();
      const transaction = db.transaction("queue", "readwrite");
      const store = transaction.objectStore("queue");
      // Samma post två gånger (samma id) läggs inte till igen.
      const existing = await request(store.index("id").getKey(item.id));
      if (existing === undefined) store.add(item);
      await done(transaction);
    },
    removeQueued: async id => {
      const db = await open();
      const transaction = db.transaction("queue", "readwrite");
      const store = transaction.objectStore("queue");
      const key = await request(store.index("id").getKey(id));
      if (key !== undefined) store.delete(key);
      await done(transaction);
    },
    mapInfo: raceId => read<StoredMapInfo>("mapInfo", raceId),
    readMap: async raceId => {
      const info = await read<StoredMapInfo>("mapInfo", raceId);
      const data = info ? await read<{ raceId: string; data: ArrayBuffer }>("mapData", raceId) : undefined;
      return info && data ? { ...info, data: data.data } : undefined;
    },
    writeMap: map => write(["mapInfo", "mapData"], transaction => {
      const { data, ...info } = map;
      transaction.objectStore("mapData").put({ raceId: map.raceId, data });
      transaction.objectStore("mapInfo").put(info);
    }),
    clearMap: raceId => write(["mapInfo", "mapData"], transaction => {
      transaction.objectStore("mapInfo").delete(raceId);
      transaction.objectStore("mapData").delete(raceId);
    })
  };
}
