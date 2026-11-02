import type {
  CourseSettingInspection, CourseSettingInspectionRequest, CourseSettingNote, CourseSettingNoteCreate, CourseSettingState
} from "@o-tid/contracts";
import { replayEdits, type CourseSettingDocument, type IdMap } from "@o-tid/course-setting";
import type { LoggedEdit } from "./course-setting-editor";
import { HttpStatusError, type GoneIds } from "./course-setting-sync";

/**
 * Steg 67 (ADR-0181 beslut 7): banläggningen utan täckning. Allt som inte är sparat på servern ligger i telefonen
 * (IndexedDB, `course-setting-offline-idb.ts`) tills servern har kvitterat det, och raderas först då (AGENTS.md):
 *
 * - **Åtgärderna** (editorns osparade logg) med versionen och dokumentet de bygger på (`FieldRecord`). Sidan läser posten
 *   när den öppnas: med nät skickas åtgärderna som vanligt (`{ baseVersion, edits }`, servern spelar upp dem på aktuell
 *   version), utan nät öppnas editorn ur posten. En begäran som var på väg när sidan stängdes skickas med samma
 *   requestId, så att servern inte gör den två gånger.
 * - **Notiser (med foto) och bockar för "kollad"** i en kö (`QueuedItem`) som skickas i ordning (`drainQueue`).
 *   ADR-0181 beslut 8: borttagna notiser och svar går samma väg (en redan borttagen räknas som gjord).
 *   Översynen 2026-11-02: kön pekar på editorns id. När editorns id byts (en kontroll som skapades utan nät fick ett annat
 *   id hos servern) översätts kön direkt (`remapQueue`), och kön skickas först när ändringarna är sparade. Det som pekar
 *   på en kontroll eller bana som aldrig kom fram tas ur kön med besked.
 * - **Kartfilen** när banläggaren väljer "Spara för offline" (`StoredMap`). Då behålls också posten utan väntande åtgärder,
 *   så att editorn kan öppnas utan nät.
 *
 * Översynen 2026-11-02: posten skrivs i två delar. Grunden (serverns version med dokumentet, notiserna och bockarna) skrivs
 * bara när den ändrats; loggen (de väntande åtgärderna och basversionen) skrivs efter varje ändring. Editorns dokument
 * sparas inte, det räknas fram ur grunden och loggen när posten läses (`joinRecord`).
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

/** Loggen i telefonen: liten, skrivs efter varje ändring. */
export interface StoredLog {
  readonly formatVersion: 2;
  readonly raceId: string;
  readonly baseVersion: number;
  readonly log: readonly LoggedEdit[];
  readonly inFlight?: FieldRecord["inFlight"];
  readonly savedAt: string;
}
/** Grunden i telefonen: serverns version som loggen bygger på, med notiser och bockar; skrivs när den ändrats. */
export interface StoredBase {
  readonly raceId: string;
  readonly version: number;
  readonly state: FieldRecord["state"];
  readonly notes?: FieldRecord["notes"];
  readonly inspections?: FieldRecord["inspections"];
}

export function splitRecord(record: FieldRecord): { log: StoredLog; base: StoredBase } {
  return {
    log: { formatVersion: 2, raceId: record.raceId, baseVersion: record.state.setting.version, log: record.log, inFlight: record.inFlight,
      savedAt: record.savedAt },
    base: { raceId: record.raceId, version: record.state.setting.version, state: record.state, notes: record.notes, inspections: record.inspections }
  };
}

/**
 * Posten ur telefonens två delar (eller en äldre hel post, format 1). En logg som bygger på en annan version än grunden
 * används inte (grunden skrivs alltid före loggen, så det händer bara om något gått sönder).
 */
export function joinRecord(stored: StoredLog | FieldRecord | undefined, base: StoredBase | undefined): FieldRecord | undefined {
  if (!stored) return undefined;
  if (stored.formatVersion === 1) return stored;
  if (stored.formatVersion !== 2 || !base || base.version !== stored.baseVersion || !Array.isArray(stored.log as unknown)) return undefined;
  const log: readonly LoggedEdit[] = stored.log;
  const start = base.state.setting.document as unknown as CourseSettingDocument;
  const document = replayEdits(start, log.map(entry => entry.edit)).document;
  return { formatVersion: 1, raceId: stored.raceId, state: base.state, document, log, inFlight: stored.inFlight,
    notes: base.notes, inspections: base.inspections, savedAt: stored.savedAt };
}

export type QueuedItem =
  | { readonly id: string; readonly raceId: string; readonly kind: "note"; readonly createdAt: string;
      readonly request: Omit<CourseSettingNoteCreate, "formatVersion"> }
  | { readonly id: string; readonly raceId: string; readonly kind: "inspection"; readonly createdAt: string;
      readonly request: CourseSettingInspectionRequest }
  /** Ta bort notisen (eller bara svaret `replyId`). */
  | { readonly id: string; readonly raceId: string; readonly kind: "note-delete"; readonly createdAt: string;
      readonly request: NoteDeleteRequest };

export interface NoteDeleteRequest { readonly noteId: string; readonly replyId?: string | undefined }

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
  /** Skriver loggen, och grunden först när `withBase` (den har ändrats sedan sist). */
  writeRecord(record: FieldRecord, withBase: boolean): Promise<void>;
  clearRecord(raceId: string): Promise<void>;
  /** Allt för alla tävlingar (utloggning). */
  clearAll(): Promise<void>;
  /** Kön i den ordning den lades till. */
  listQueue(raceId: string): Promise<QueuedItem[]>;
  addQueued(item: QueuedItem): Promise<void>;
  removeQueued(id: string): Promise<void>;
  /** Byter en post i kön (samma plats i ordningen). */
  updateQueued(item: QueuedItem): Promise<void>;
  mapInfo(raceId: string): Promise<StoredMapInfo | undefined>;
  readMap(raceId: string): Promise<StoredMap | undefined>;
  writeMap(map: StoredMap): Promise<void>;
  clearMap(raceId: string): Promise<void>;
}

/** Lagret i minnet (testerna, och webbläsare utan IndexedDB: då tål inget en omladdning). */
export function memoryFieldStore(): FieldStore {
  const logs = new Map<string, StoredLog>(), bases = new Map<string, StoredBase>(), queue: QueuedItem[] = [], maps = new Map<string, StoredMap>();
  return {
    readRecord: async raceId => joinRecord(structuredClone(logs.get(raceId)), structuredClone(bases.get(raceId))),
    writeRecord: async (record, withBase) => {
      const parts = splitRecord(record);
      if (withBase) bases.set(record.raceId, structuredClone(parts.base));
      logs.set(record.raceId, structuredClone(parts.log));
    },
    clearRecord: async raceId => { logs.delete(raceId); bases.delete(raceId); },
    clearAll: async () => { logs.clear(); bases.clear(); queue.splice(0); maps.clear(); },
    listQueue: async raceId => queue.filter(item => item.raceId === raceId),
    addQueued: async item => { if (!queue.some(row => row.id === item.id)) queue.push(structuredClone(item)); },
    removeQueued: async id => { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); },
    updateQueued: async item => { const index = queue.findIndex(row => row.id === item.id); if (index >= 0) queue[index] = structuredClone(item); },
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

/** Det som grunden består av; skrivs om bara när något av det har bytts (jämförs som referenser). */
export interface BaseKey { readonly version: number; readonly parts: readonly unknown[] }

/**
 * Skriver posten i telefonen: loggen varje gång, grunden bara när den ändrats sedan den senast skrevs. Ett fel (t.ex.
 * full lagring) rapporteras med `onResult(error)` och nästa skrivning tar med grunden igen; `onResult(undefined)` när det
 * gick.
 */
export class RecordWriter {
  private written: BaseKey | undefined;
  constructor(private readonly store: FieldStore, private readonly onResult: (error: unknown) => void) {}

  async write(raceId: string, record: FieldRecord | undefined, key: BaseKey): Promise<boolean> {
    const last = this.written;
    const withBase = !last || last.version !== key.version || last.parts.length !== key.parts.length ||
      last.parts.some((part, index) => part !== key.parts[index]);
    try {
      if (record) await this.store.writeRecord(record, withBase); else await this.store.clearRecord(raceId);
      this.written = record ? key : undefined;
      this.onResult(undefined);
      return true;
    } catch (error) {
      this.written = undefined;
      this.onResult(error);
      return false;
    }
  }
}

/** Posten kan användas: rätt format och tävling och en logg som stämmer med sig själv. */
export function usableRecord(record: FieldRecord | undefined, raceId: string): FieldRecord | undefined {
  if (!record || record.formatVersion !== 1 || record.raceId !== raceId || !record.state?.setting || !record.document) return undefined;
  const log: readonly LoggedEdit[] = record.log;
  if (!Array.isArray(record.log)) return undefined;
  if (log.some((entry, index) => index > 0 && entry.seq <= log[index - 1]!.seq)) return undefined;
  return record;
}

/** Kontrollerna och banorna som posten pekar på. */
function queuedRefs(item: QueuedItem): { controls: string[]; courses: string[] } {
  if (item.kind === "inspection") return { controls: [item.request.control], courses: [] };
  if (item.kind === "note-delete") return { controls: [], courses: [] };
  const target = item.request.target;
  const controls = target.kind === "CONTROL" ? [target.control] : target.kind === "LEG" ? [target.from, target.to] : [];
  const course = target.kind === "COURSE" ? target.course : item.request.course;
  return { controls, courses: course ? [course] : [] };
}

/**
 * Posten med editorns gamla id översatta till de nya (`map`), eller "gone" om den pekar på en kontroll eller bana som inte
 * finns längre (skapad av en ändring som inte gick). Översättningen görs på en gång för alla id (en kontroll 57 → 58 och
 * 58 → 59 byter inte plats två gånger).
 */
export function remapQueuedItem(item: QueuedItem, map: IdMap, gone: GoneIds = { controls: [], courses: [] }): QueuedItem | "gone" {
  const refs = queuedRefs(item);
  if (refs.controls.some(id => gone.controls.includes(id) && map.controls[id] === undefined) ||
    refs.courses.some(id => gone.courses.includes(id) && map.courses[id] === undefined)) return "gone";
  const c = (id: string) => map.controls[id] ?? id, co = (id: string) => map.courses[id] ?? id;
  if (item.kind === "note-delete") return item;
  if (item.kind === "inspection") {
    const control = c(item.request.control);
    return control === item.request.control ? item : { ...item, request: { ...item.request, control } };
  }
  const target = item.request.target;
  const next = target.kind === "CONTROL" ? { ...target, control: c(target.control) }
    : target.kind === "LEG" ? { ...target, from: c(target.from), to: c(target.to) }
    : target.kind === "COURSE" ? { ...target, course: co(target.course) } : target;
  const course = item.request.course === null || item.request.course === undefined ? item.request.course : co(item.request.course);
  if (JSON.stringify(next) === JSON.stringify(target) && course === item.request.course) return item;
  return { ...item, request: { ...item.request, target: next, course } };
}

/** Översätter kön i telefonen; ger posterna som togs bort för att de pekar på något som inte finns. */
export async function remapQueue(store: FieldStore, raceId: string, map: IdMap, gone?: GoneIds): Promise<QueuedItem[]> {
  const removed: QueuedItem[] = [];
  for (const item of await store.listQueue(raceId)) {
    const next = remapQueuedItem(item, map, gone);
    if (next === "gone") { await store.removeQueued(item.id); removed.push(item); }
    else if (next !== item) await store.updateQueued(next);
  }
  return removed;
}

export interface QueueTransport {
  readonly note: (raceId: string, request: Omit<CourseSettingNoteCreate, "formatVersion">) => Promise<unknown>;
  readonly inspection: (raceId: string, request: CourseSettingInspectionRequest) => Promise<unknown>;
  readonly deleteNote: (raceId: string, request: NoteDeleteRequest) => Promise<unknown>;
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
      else if (item.kind === "note-delete") await transport.deleteNote(raceId, item.request);
      else await transport.inspection(raceId, item.request);
    } catch (error) {
      const kind = classify(error);
      // Redan borttagen (av någon annan, eller ett försök som nådde fram men vars svar inte kom tillbaka).
      if (item.kind === "note-delete" && typeof kind === "object" && kind.status === 404) {
        await store.removeQueued(item.id);
        sent.push(item);
        continue;
      }
      // Inte din notis och du får inte ändra: ett besked om just den, inte utloggad (resten av kön skickas).
      if (item.kind === "note-delete" && error instanceof HttpStatusError && error.status === 403) {
        await store.removeQueued(item.id);
        rejected.push({ item, status: 403 });
        continue;
      }
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
