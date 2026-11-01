import type {
  CourseSettingInspection, CourseSettingInspectionRequest, CourseSettingNote, CourseSettingNoteCreate, CourseSettingState
} from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { LoggedEdit } from "./course-setting-editor";
import { HttpStatusError } from "./course-setting-sync";

/**
 * Steg 67 (ADR-0181 beslut 7): banläggningen utan täckning. Allt som inte är sparat på servern ligger i telefonen
 * (IndexedDB, `course-setting-offline-idb.ts`) tills servern har kvitterat det, och raderas först då (AGENTS.md):
 *
 * - **Åtgärderna** (editorns osparade logg) med versionen och dokumentet de bygger på (`FieldRecord`). Sidan läser posten
 *   när den öppnas: med nät skickas åtgärderna som vanligt (`{ baseVersion, edits }`, servern spelar upp dem på aktuell
 *   version), utan nät öppnas editorn ur posten. En begäran som var på väg när sidan stängdes skickas med samma
 *   requestId, så att servern inte gör den två gånger.
 * - **Notiser (med foto) och bockar för "kollad"** i en kö (`QueuedItem`) som skickas i ordning (`drainQueue`).
 * - **Kartfilen** när banläggaren väljer "Spara för offline" (`StoredMap`). Då behålls också posten utan väntande åtgärder,
 *   så att editorn kan öppnas utan nät.
 *
 * Ren logik och ett lager i minnet för testerna; inget här rör webbläsaren.
 */

/** Editorns läge som inte får gå förlorat. `state.setting` är serverns version som åtgärderna bygger på. */
export interface FieldRecord {
  readonly formatVersion: 1;
  readonly raceId: string;
  readonly state: CourseSettingState & { readonly setting: NonNullable<CourseSettingState["setting"]> };
  /** Editorns dokument med åtgärderna gjorda. */
  readonly document: CourseSettingDocument;
  readonly log: readonly LoggedEdit[];
  /** Begäran som var skickad men inte kvitterad: samma requestId för åtgärderna till och med `upTo`. */
  readonly inFlight?: { readonly requestId: string; readonly upTo: number } | undefined;
  /** Senast hämtade notiser och bockar, så att de syns när sidan öppnas utan nät. */
  readonly notes?: readonly CourseSettingNote[] | undefined;
  readonly inspections?: readonly CourseSettingInspection[] | undefined;
  readonly savedAt: string;
}

export type QueuedItem =
  | { readonly id: string; readonly raceId: string; readonly kind: "note"; readonly createdAt: string;
      readonly request: Omit<CourseSettingNoteCreate, "formatVersion"> }
  | { readonly id: string; readonly raceId: string; readonly kind: "inspection"; readonly createdAt: string;
      readonly request: CourseSettingInspectionRequest };

export interface StoredMapInfo {
  readonly raceId: string;
  readonly sha256: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly savedAt: string;
}
export interface StoredMap extends StoredMapInfo { readonly data: ArrayBuffer }

export interface FieldStore {
  readRecord(raceId: string): Promise<FieldRecord | undefined>;
  writeRecord(record: FieldRecord): Promise<void>;
  clearRecord(raceId: string): Promise<void>;
  /** Kön i den ordning den lades till. */
  listQueue(raceId: string): Promise<QueuedItem[]>;
  addQueued(item: QueuedItem): Promise<void>;
  removeQueued(id: string): Promise<void>;
  mapInfo(raceId: string): Promise<StoredMapInfo | undefined>;
  readMap(raceId: string): Promise<StoredMap | undefined>;
  writeMap(map: StoredMap): Promise<void>;
  clearMap(raceId: string): Promise<void>;
}

/** Lagret i minnet (testerna, och webbläsare utan IndexedDB: då tål inget en omladdning). */
export function memoryFieldStore(): FieldStore {
  const records = new Map<string, FieldRecord>(), queue: QueuedItem[] = [], maps = new Map<string, StoredMap>();
  return {
    readRecord: async raceId => records.get(raceId),
    writeRecord: async record => { records.set(record.raceId, structuredClone(record)); },
    clearRecord: async raceId => { records.delete(raceId); },
    listQueue: async raceId => queue.filter(item => item.raceId === raceId),
    addQueued: async item => { if (!queue.some(row => row.id === item.id)) queue.push(structuredClone(item)); },
    removeQueued: async id => { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); },
    mapInfo: async raceId => {
      const map = maps.get(raceId);
      return map && { raceId: map.raceId, sha256: map.sha256, fileName: map.fileName, bytes: map.bytes, savedAt: map.savedAt };
    },
    readMap: async raceId => maps.get(raceId),
    writeMap: async map => { maps.set(map.raceId, map); },
    clearMap: async raceId => { maps.delete(raceId); }
  };
}

/** Posten att spara: undefined = inget behöver ligga kvar (inga väntande åtgärder och inte sparad för offline). */
export function recordToKeep(input: { raceId: string; state: CourseSettingState; version: number; base: CourseSettingDocument;
  document: CourseSettingDocument; log: readonly LoggedEdit[]; inFlight?: FieldRecord["inFlight"]; offline: boolean; now: Date;
  notes?: readonly CourseSettingNote[]; inspections?: readonly CourseSettingInspection[] }): FieldRecord | undefined {
  if (!input.state.setting || (input.log.length === 0 && !input.inFlight && !input.offline)) return undefined;
  return { formatVersion: 1, raceId: input.raceId,
    state: { ...input.state, setting: { ...input.state.setting, version: input.version, document: input.base as never } },
    document: input.document, log: input.log, inFlight: input.inFlight, notes: input.notes, inspections: input.inspections,
    savedAt: input.now.toISOString() };
}

/** Posten kan användas: rätt format och tävling och en logg som stämmer med sig själv. */
export function usableRecord(record: FieldRecord | undefined, raceId: string): FieldRecord | undefined {
  if (!record || record.formatVersion !== 1 || record.raceId !== raceId || !record.state?.setting || !record.document) return undefined;
  const log: readonly LoggedEdit[] = record.log;
  if (!Array.isArray(record.log)) return undefined;
  if (log.some((entry, index) => index > 0 && entry.seq <= log[index - 1]!.seq)) return undefined;
  return record;
}

export interface QueueTransport {
  readonly note: (raceId: string, request: Omit<CourseSettingNoteCreate, "formatVersion">) => Promise<unknown>;
  readonly inspection: (raceId: string, request: CourseSettingInspectionRequest) => Promise<unknown>;
}

export interface DrainResult {
  readonly sent: readonly QueuedItem[];
  /** Servern tog inte emot (4xx): borttagna ur kön, med beskedet. */
  readonly rejected: readonly { readonly item: QueuedItem; readonly status: number }[];
  /** Varför kön stannade: inget nät (eller servern svarar inte) eller inte inloggad. Det som är kvar skickas sedan. */
  readonly stopped?: "offline" | "auth" | undefined;
}

/** Stannar kön (och ska försökas igen) eller är det ett besked om just den här posten? */
function classify(error: unknown): "offline" | "auth" | { status: number } {
  if (error instanceof HttpStatusError) {
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status === 408 || error.status === 429 || error.status >= 500) return "offline";
    return { status: error.status };
  }
  // CSRF-kakan saknas: utloggad.
  if (error instanceof Error && error.message === "csrf") return "auth";
  return "offline";
}

/**
 * Skickar kön i ordning. En post tas bort först när servern har svarat (sparad, eller avvisad med 4xx). Nätfel, 5xx och
 * utloggning stoppar kön med posten kvar; notiserna har requestId och bockarna tiden, så ett nytt försök gör inget två gånger.
 */
export async function drainQueue(store: FieldStore, raceId: string, transport: QueueTransport): Promise<DrainResult> {
  const sent: QueuedItem[] = [], rejected: { item: QueuedItem; status: number }[] = [];
  for (const item of await store.listQueue(raceId)) {
    try {
      if (item.kind === "note") await transport.note(raceId, item.request);
      else await transport.inspection(raceId, item.request);
    } catch (error) {
      const kind = classify(error);
      if (kind === "offline" || kind === "auth") return { sent, rejected, stopped: kind };
      await store.removeQueued(item.id);
      rejected.push({ item, status: kind.status });
      continue;
    }
    await store.removeQueued(item.id);
    sent.push(item);
  }
  return { sent, rejected };
}
