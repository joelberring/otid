import {
  COURSE_SETTING_EDITS_MAX_BYTES, type CourseSettingEditsRequest, type CourseSettingEditsSaved
} from "@o-tid/contracts";
import {
  documentChanges, editTouches, remapEdit, replayEdits, type CourseSettingDocument, type CourseSettingEdit, type IdMap
} from "@o-tid/course-setting";
import { stillThere, wireCreated, type EditorState, type HistoryStep, type LoggedEdit, type Selection } from "./course-setting-editor";
import { inLanguage } from "./in-language";

/**
 * Steg 66 (ADR-0181 beslut 4): samtidigt arbete i editorn. Editorns läge finns i en `EditorStore` (React läser den med
 * `useSyncExternalStore`), så att sparandet alltid ser det senaste. `CourseSettingSync` skickar de osparade åtgärderna
 * (`log`) mot versionen den känner, och när någon annan har sparat (svaret eller strömmen säger det) hämtas den nya
 * versionen och de egna osparade åtgärderna spelas upp på den (`rebaseEditor`), med ångra-historiken: steg som rör något
 * som någon annan ändrat tas bort, övriga får de nya id:n. Ren logik utan React; anropen och tiden ges utifrån.
 *
 * Översynen 2026-11-02: de osparade åtgärderna skickas i omgångar (högst `SAVE_BATCH_EDITS` åtgärder och ungefär
 * `SAVE_BATCH_BYTES`), så att tusentals åtgärder eller stora bilder från telefonen inte går över serverns gräns. En
 * omgång som servern inte kan läsa (400) eller som är för stor (413) räknas aldrig som avvisad: sidan läser om och
 * försöker igen med mindre omgångar. Bara en enda åtgärd som servern ändå inte tar emot (för stor, eller oläslig två
 * gånger efter omläsning) stryks, med besked. Det som servern avvisar per åtgärd (index) stryks som förut.
 */
export type SyncStatus = "saved" | "pending" | "saving" | "failed" | "stopped";

/** Högst så många åtgärder och ungefär så många byte i en omgång. */
export const SAVE_BATCH_EDITS = 500;
export const SAVE_BATCH_BYTES = 1024 * 1024;
/** En åtgärd som är större än så (med kuvertet) går inte att spara alls. */
export const SAVE_EDIT_MAX_BYTES = COURSE_SETTING_EDITS_MAX_BYTES - 8 * 1024;
/** Beskeden när en enskild åtgärd inte går att spara. */
export const EDIT_TOO_LARGE = inLanguage("Ändringen är för stor för att sparas (högst 4 MB). Gör bilden mindre och försök igen.", "The change is too large to save (at most 4 MB). Make the image smaller and try again.");
export const EDIT_UNREADABLE = inLanguage("Servern kunde inte läsa ändringen.", "The server could not read the change.");

const sizes = new WeakMap<object, number>();
const encoder = new TextEncoder();
/** Åtgärdens storlek som JSON (räknas en gång per åtgärd). */
export function editBytes(entry: LoggedEdit): number {
  let size = sizes.get(entry);
  if (size === undefined) {
    size = encoder.encode(JSON.stringify(entry.edit)).byteLength + encoder.encode(JSON.stringify(entry.created)).byteLength + 2;
    sizes.set(entry, size);
  }
  return size;
}

/** Nästa omgång: i ordning, högst `edits` åtgärder och `bytes` byte, men alltid minst en. */
export function takeBatch(entries: readonly LoggedEdit[], limit: { readonly edits: number; readonly bytes: number }): LoggedEdit[] {
  const batch: LoggedEdit[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = editBytes(entry);
    if (batch.length > 0 && (batch.length >= limit.edits || bytes + size > limit.bytes)) break;
    batch.push(entry);
    bytes += size;
  }
  return batch;
}

export class EditorStore {
  private listeners = new Set<() => void>();
  constructor(public state: EditorState) {}
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update(change: (state: EditorState) => EditorState): void {
    const next = change(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/** Det som inte gick att göra efter andras ändringar, för beskedet. */
export interface LostEdit { readonly edit: CourseSettingEdit; readonly message: string }

export interface RebaseInput {
  /** Det som de osparade åtgärderna gjordes mot (serverns version som editorn kände, med det som just sparats). */
  readonly base: CourseSettingDocument;
  /** Den nya versionen från servern. */
  readonly current: CourseSettingDocument;
  readonly version: number;
  /** Åtgärder till och med detta löpnummer är sparade (tas bort ur loggen). */
  readonly ackedUpTo?: number | undefined;
  /** Sparade åtgärder som servern avvisade. */
  readonly rejected?: readonly { readonly seq: number; readonly message: string }[] | undefined;
  /** Servern: författarens id → dokumentets id för det som just sparades. */
  readonly idMap?: IdMap | undefined;
}

function remapSelection(selection: Selection | undefined, map: IdMap): Selection | undefined {
  if (!selection) return undefined;
  const c = (id: string) => map.controls[id] ?? id, cc = (id: string | undefined) => id === undefined ? undefined : map.courseControls[id] ?? id;
  if (selection.kind === "special") return { kind: "special", special: map.specialObjects?.[selection.special] ?? selection.special };
  return selection.kind === "control" ? { kind: "control", control: c(selection.control), courseControl: cc(selection.courseControl) }
    : { ...selection, from: c(selection.from), to: c(selection.to), fromCourseControl: cc(selection.fromCourseControl),
      toCourseControl: cc(selection.toCourseControl) };
}

/** Spela upp de osparade åtgärderna (eller förslaget) och historiken på en ny version. */
/** Id som editorn hade men som inte finns längre (skapade av åtgärder som inte gick). */
export interface GoneIds { readonly controls: readonly string[]; readonly courses: readonly string[] }

export function rebaseEditor(state: EditorState, input: RebaseInput): { state: EditorState; lost: LostEdit[]; idMap: IdMap; gone: GoneIds } {
  if (state.dragBase) state = { ...state, document: state.dragBase, dragBase: undefined, dragEdit: undefined };
  const pending = state.log.filter(entry => entry.seq > (input.ackedUpTo ?? 0));
  const conflict = documentChanges(input.base, input.current);
  const replay = replayEdits(input.current, pending.map(entry => entry.edit), { created: pending.map(entry => entry.created),
    idMap: input.idMap, conflict });
  const bySeq = new Map<number, LoggedEdit>();
  for (const applied of replay.applied) {
    const seq = pending[applied.index]!.seq;
    bySeq.set(seq, { seq, edit: applied.edit, created: applied.created });
  }
  const lostSeqs = new Set<number>([...(input.rejected ?? []).map(row => row.seq), ...replay.rejected.map(row => pending[row.index]!.seq)]);
  const lost: LostEdit[] = [
    ...(input.rejected ?? []).map(row => ({ edit: state.log.find(entry => entry.seq === row.seq)?.edit ?? { type: "SET_EVENT", changes: {} },
      message: row.message } as LostEdit)),
    ...replay.rejected.map(row => ({ edit: row.edit, message: row.message }))
  ];
  const fix = (step: HistoryStep): HistoryStep | undefined => {
    if (step.entries.some(entry => lostSeqs.has(entry.seq))) return undefined;
    const entries = step.entries.map(entry => bySeq.get(entry.seq) ?? entry);
    if (!step.undo) return { entries };
    const remapped = remapEdit(step.undo, replay.idMap);
    if (remapped.type !== "PUT_OBJECTS") return undefined;
    const authorTouches = editTouches(step.undo), actualTouches = editTouches(remapped);
    if (actualTouches.some((touch, index) => conflict(authorTouches[index] ?? touch, touch))) return undefined;
    return { undo: remapped, entries };
  };
  const document = replay.document;
  const next: EditorState = {
    ...state, document, log: pending.filter(entry => bySeq.has(entry.seq)).map(entry => bySeq.get(entry.seq)!),
    past: state.past.map(fix).filter((step): step is HistoryStep => step !== undefined),
    future: state.future.map(fix).filter((step): step is HistoryStep => step !== undefined),
    selection: stillThere(document, remapSelection(state.selection, replay.idMap)),
    view: state.view === "ALL_CONTROLS" || document.courses.some(course => course.id === state.view) ? state.view : "ALL_CONTROLS",
    revision: state.revision + 1,
    ...(state.suggesting ? { suggesting: { base: input.current, baseVersion: input.version } } : {})
  };
  const lostCreated = state.log.filter(entry => lostSeqs.has(entry.seq)).map(entry => entry.created);
  const gone = { controls: lostCreated.flatMap(created => created.controls), courses: lostCreated.flatMap(created => created.courses) };
  return { state: next, lost, idMap: replay.idMap, gone };
}

/** Sparade åtgärder (till och med löpnumret) tas bort ur loggen; dokumentet är redan detsamma som serverns. */
export function acknowledge(state: EditorState, upTo: number): EditorState {
  return state.log.some(entry => entry.seq <= upTo) ? { ...state, log: state.log.filter(entry => entry.seq > upTo) } : state;
}

/** Översättningen byter något id (inte bara samma id). */
export function changesIds(map: IdMap): boolean {
  const records: readonly (Readonly<Record<string, string>> | undefined)[] = [map.controls, map.courseControls, map.courses, map.specialObjects];
  return records.some(record => Object.entries(record ?? {}).some(([from, to]) => from !== to));
}

export class HttpStatusError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

export interface SyncTransport {
  readonly saveEdits: (request: CourseSettingEditsRequest) => Promise<CourseSettingEditsSaved>;
  readonly fetchSetting: () => Promise<{ readonly version: number; readonly document: CourseSettingDocument }>;
}

export interface SyncOptions {
  readonly onStatus: (status: SyncStatus) => void;
  /** Egna åtgärder som inte gick efter andras ändringar. */
  readonly onLost: (lost: readonly LostEdit[]) => void;
  /** En ny version (egen eller andras) är inläst. */
  readonly onVersion?: (version: number) => void;
  readonly delayMs?: number;
  readonly retryMs?: number;
  readonly newId?: () => string;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
  /** Steg 67: begäran som var på väg när sidan stängdes (ur telefonens lagring) skickas med samma requestId. */
  readonly resume?: { readonly requestId: string; readonly upTo: number } | undefined;
}

type After = { ackedUpTo: number; authorView: CourseSettingDocument; idMap?: IdMap; rejected: readonly { seq: number; message: string }[];
  /** Begäran som sparades (det sparade är inte inläst än; samma requestId om sidan stängs innan). */
  request?: { requestId: string; upTo: number } };

interface InFlight { readonly request: CourseSettingEditsRequest; readonly entries: readonly LoggedEdit[]; readonly authorView: CourseSettingDocument }

export class CourseSettingSync {
  private serverVersion: number;
  private serverDocument: CourseSettingDocument;
  private sentUpTo = 0;
  private inFlight: InFlight | undefined;
  /** Sparat men den nya versionen är inte inläst än (nätet). */
  private unread: After | undefined;
  private remoteVersion = 0;
  private timer: unknown;
  private running: Promise<void> | undefined;
  private stopped = false;
  private detached = false;
  private resumeRequest: SyncOptions["resume"];
  /** Omgångens storlek; halveras vid 413 och 400 och går tillbaka efter ett lyckat sparande. */
  private limit = { edits: SAVE_BATCH_EDITS, bytes: SAVE_BATCH_BYTES };
  /** Första åtgärden i senaste omgången som servern inte kunde läsa (400) och hur många gånger. */
  private unreadable: { seq: number; count: number } | undefined;
  private readonly idListeners = new Set<(map: IdMap, gone: GoneIds) => void>();
  private readonly delayMs: number;
  private readonly retryMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly store: EditorStore, base: { version: number; document: CourseSettingDocument },
    private readonly transport: SyncTransport, private readonly options: SyncOptions) {
    this.serverVersion = base.version;
    this.serverDocument = base.document;
    this.delayMs = options.delayMs ?? 400;
    this.retryMs = options.retryMs ?? 3000;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.resumeRequest = options.resume;
  }

  /**
   * Editorns id har bytts (egna nya kontroller fick andra id hos servern, eller spelades upp på andras version): editorns
   * gamla id → nya, och id som inte finns längre. Anropas direkt när editorn har bytt, så att telefonens kö kan översättas
   * innan något nytt läggs i den.
   */
  listenIds(listener: (map: IdMap, gone: GoneIds) => void): () => void {
    this.idListeners.add(listener);
    return () => { this.idListeners.delete(listener); };
  }

  get version(): number { return this.serverVersion; }
  get document(): CourseSettingDocument { return this.serverDocument; }
  /** Något är inte sparat. */
  get dirty(): boolean { return this.inFlight !== undefined || this.unread !== undefined || this.unsent().length > 0; }
  /** Steg 67: den skickade begäran som inte är kvitterad (sparas i telefonen med åtgärderna). */
  get pendingRequest(): { requestId: string; upTo: number } | undefined {
    const flight = this.inFlight;
    return flight ? { requestId: flight.request.requestId, upTo: flight.entries.at(-1)!.seq } : this.unread?.request ?? this.resumeRequest;
  }
  /** Sparandet har stannat (utloggad). */
  get halted(): boolean { return this.stopped; }

  /** Steg 67: efter en ny inloggning (eller när nätet är tillbaka) försöker sparandet igen direkt. */
  resume(): void {
    this.stopped = false;
    if (this.dirty || this.remoteVersion > this.serverVersion) { this.options.onStatus("pending"); this.schedule(0); }
  }

  private unsent(): LoggedEdit[] {
    const state = this.store.state;
    return state.suggesting ? [] : state.log.filter(entry => entry.seq > this.sentUpTo);
  }

  /** Editorn har ändrats: spara efter en kort paus. */
  changed(): void {
    if (this.stopped || this.unsent().length === 0) return;
    this.options.onStatus("pending");
    this.schedule(this.delayMs);
  }

  /** Strömmen: någon har sparat en ny version. */
  remote(version: number): void {
    if (version <= this.serverVersion) return;
    this.remoteVersion = Math.max(this.remoteVersion, version);
    if (!this.inFlight) this.schedule(50);
  }

  /** Spara nu och vänta (t.ex. före överföringen eller utskriften). */
  async flush(): Promise<void> {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    // Så länge något händer (omgångarna kan vara många); fem varv utan framsteg räcker.
    let still = 0;
    while (still < 5 && !this.stopped) {
      while (this.running) await this.running;
      if (!this.dirty && this.remoteVersion <= this.serverVersion) return;
      const before = this.progress();
      await this.run();
      if (this.inFlight) return; // nätet: försöker igen senare
      still = this.progress() === before ? still + 1 : 0;
    }
  }

  private progress(): string {
    return `${this.serverVersion}:${this.sentUpTo}:${this.store.state.log.length}:${this.limit.edits}:${this.unreadable?.count ?? 0}`;
  }

  /** Ett nytt dokument från servern (inläsning, återställning): sparandet börjar om därifrån. */
  reset(version: number, document: CourseSettingDocument): void {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    this.serverVersion = version; this.serverDocument = document; this.inFlight = undefined; this.unread = undefined; this.stopped = false;
    this.sentUpTo = Math.max(0, ...this.store.state.log.map(entry => entry.seq));
    this.options.onStatus("saved");
    this.options.onVersion?.(version);
  }

  attach(): void { this.detached = false; if (this.dirty || this.remoteVersion > this.serverVersion) this.schedule(this.delayMs); }
  detach(): void { this.detached = true; if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; } }

  /** Efter en dragning: det som väntade görs nu. */
  poke(): void { if (this.dirty || this.remoteVersion > this.serverVersion) this.schedule(this.delayMs); }

  private schedule(ms: number): void {
    if (this.detached) return;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = undefined; void this.run(); }, ms);
  }

  private run(): Promise<void> {
    if (this.running || this.stopped || this.detached) return this.running ?? Promise.resolve();
    this.running = this.step().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async step(): Promise<void> {
    // En dragning pågår: vänta tills den är klar (editorn anropar `poke`).
    if (this.store.state.dragBase) return;
    if (this.unread) { await this.refresh(this.unread); return; }
    if (!this.inFlight) {
      let entries = this.unsent();
      // Steg 67: samma requestId som förra gången för åtgärderna som då var på väg (servern ger samma svar igen).
      const resumed = this.resumeRequest;
      this.resumeRequest = undefined;
      const resuming = resumed !== undefined && entries.length > 0 && entries[0]!.seq <= resumed.upTo;
      entries = resuming ? entries.filter(entry => entry.seq <= resumed.upTo) : takeBatch(entries, this.limit);
      if (entries.length === 0) {
        if (this.remoteVersion > this.serverVersion) await this.refresh();
        return;
      }
      // En enda åtgärd som är större än serverns gräns går aldrig att spara: besked direkt, utan att skicka.
      if (entries.length === 1 && editBytes(entries[0]!) > SAVE_EDIT_MAX_BYTES) { await this.dropSingle(entries[0]!, EDIT_TOO_LARGE); return; }
      const authorView = replayEdits(this.serverDocument, entries.map(entry => entry.edit)).document;
      const requestId = resuming ? resumed.requestId : (this.options.newId ?? (() => crypto.randomUUID()))();
      this.inFlight = { entries, authorView, request: { formatVersion: 1, requestId,
        baseVersion: this.serverVersion, edits: entries.map(entry => entry.edit) as CourseSettingEditsRequest["edits"],
        created: entries.map(entry => wireCreated(entry.created)) } };
      this.sentUpTo = entries.at(-1)!.seq;
    }
    const flight = this.inFlight;
    this.options.onStatus("saving");
    let response: CourseSettingEditsSaved;
    try {
      response = await this.transport.saveEdits(flight.request);
    } catch (error) {
      const status = error instanceof HttpStatusError ? error.status : undefined;
      if (status === 401 || status === 403) { this.stopped = true; this.options.onStatus("stopped"); return; }
      if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        await this.notTaken(flight, status);
        return;
      }
      this.options.onStatus("failed");
      this.schedule(this.retryMs);
      return;
    }
    this.inFlight = undefined;
    this.limit = { edits: SAVE_BATCH_EDITS, bytes: SAVE_BATCH_BYTES };
    this.unreadable = undefined;
    const upTo = flight.entries.at(-1)!.seq;
    const fast = !response.rebased && response.rejected.length === 0 && response.applied === flight.entries.length &&
      response.version === this.serverVersion + 1;
    if (fast) {
      this.serverVersion = response.version;
      this.serverDocument = flight.authorView;
      this.store.update(state => acknowledge(state, upTo));
      this.options.onVersion?.(response.version);
    } else {
      await this.refresh({ ackedUpTo: upTo, authorView: flight.authorView, idMap: response.idMap,
        rejected: response.rejected.map(row => ({ seq: flight.entries[row.index]!.seq, message: row.message })),
        request: { requestId: flight.request.requestId, upTo } });
    }
    if (this.dirty || this.remoteVersion > this.serverVersion) this.schedule(this.delayMs);
    else this.options.onStatus("saved");
  }

  /**
   * Servern tog inte emot omgången (4xx för hela begäran). Inget i den är avvisat: 413 = för stor, försök med hälften;
   * 400 m.fl. = läs om (versionen kan vara fel) och försök igen, med hälften om det händer igen. Bara en ensam åtgärd som
   * är för stor, eller som inte går att läsa två gånger efter omläsning, stryks.
   */
  private async notTaken(flight: InFlight, status: number): Promise<void> {
    this.inFlight = undefined;
    const first = flight.entries[0]!;
    this.sentUpTo = first.seq - 1;
    if (status === 413) {
      if (flight.entries.length === 1) { await this.dropSingle(first, EDIT_TOO_LARGE); return; }
      this.limit = { edits: Math.max(1, Math.floor(flight.entries.length / 2)), bytes: Math.max(1, Math.floor(this.limit.bytes / 2)) };
      this.options.onStatus("pending");
      this.schedule(0);
      return;
    }
    const count = this.unreadable?.seq === first.seq ? this.unreadable.count + 1 : 1;
    this.unreadable = { seq: first.seq, count };
    if (flight.entries.length === 1 && count >= 2) { this.unreadable = undefined; await this.dropSingle(first, EDIT_UNREADABLE); return; }
    if (count >= 2) this.limit = { edits: Math.max(1, Math.floor(flight.entries.length / 2)), bytes: this.limit.bytes };
    // Läs om och spela upp alla osparade åtgärder på serverns version (inget är sparat, inget är avvisat).
    await this.refresh({ ackedUpTo: first.seq - 1, authorView: this.serverDocument, rejected: [] }, true);
    if (!this.unread) this.schedule(0);
  }

  /** En ensam åtgärd som inte går att spara: stryks med besked, resten sparas som vanligt. */
  private async dropSingle(entry: LoggedEdit, message: string): Promise<void> {
    this.sentUpTo = Math.max(this.sentUpTo, entry.seq);
    await this.refresh({ ackedUpTo: entry.seq, authorView: this.serverDocument, rejected: [{ seq: entry.seq, message }] }, true);
    if (this.dirty || this.remoteVersion > this.serverVersion) this.schedule(this.delayMs);
  }

  private async refresh(after?: After, always = false): Promise<void> {
    let fetched: { version: number; document: CourseSettingDocument };
    try {
      fetched = await this.transport.fetchSetting();
    } catch {
      this.options.onStatus("failed");
      // Det sparade finns på servern; nästa försök läser om och spelar upp resten.
      this.unread = after;
      this.schedule(this.retryMs);
      return;
    }
    this.unread = undefined;
    if (!after && !always && fetched.version <= this.serverVersion) {
      this.remoteVersion = 0;
      if (!this.dirty) this.options.onStatus("saved");
      return;
    }
    let lost: LostEdit[] = [];
    let idMap: IdMap | undefined, gone: GoneIds | undefined;
    this.store.update(state => {
      const result = rebaseEditor(state, { base: after?.authorView ?? this.serverDocument, current: fetched.document, version: fetched.version,
        ackedUpTo: after?.ackedUpTo, rejected: after?.rejected, idMap: after?.idMap });
      lost = result.lost;
      idMap = result.idMap;
      gone = result.gone;
      return result.state;
    });
    if (idMap && gone && (changesIds(idMap) || gone.controls.length > 0 || gone.courses.length > 0)) { for (const listener of this.idListeners) listener(idMap, gone); }
    this.serverVersion = fetched.version;
    this.serverDocument = fetched.document;
    this.sentUpTo = Math.max(this.sentUpTo, after?.ackedUpTo ?? 0);
    if (this.remoteVersion <= fetched.version) this.remoteVersion = 0;
    this.options.onVersion?.(fetched.version);
    if (lost.length > 0) this.options.onLost(lost);
    if (!this.dirty) this.options.onStatus("saved");
  }
}
