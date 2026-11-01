import type { CourseSettingEditsRequest, CourseSettingEditsSaved } from "@o-tid/contracts";
import {
  documentChanges, editTouches, remapEdit, replayEdits, type CourseSettingDocument, type CourseSettingEdit, type IdMap
} from "@o-tid/course-setting";
import { stillThere, type EditorState, type HistoryStep, type LoggedEdit, type Selection } from "./course-setting-editor";

/**
 * Steg 66 (ADR-0181 beslut 4): samtidigt arbete i editorn. Editorns läge finns i en `EditorStore` (React läser den med
 * `useSyncExternalStore`), så att sparandet alltid ser det senaste. `CourseSettingSync` skickar de osparade åtgärderna
 * (`log`) mot versionen den känner, och när någon annan har sparat (svaret eller strömmen säger det) hämtas den nya
 * versionen och de egna osparade åtgärderna spelas upp på den (`rebaseEditor`), med ångra-historiken: steg som rör något
 * som någon annan ändrat tas bort, övriga får de nya id:n. Ren logik utan React; anropen och tiden ges utifrån.
 */
export type SyncStatus = "saved" | "pending" | "saving" | "failed" | "too-large" | "stopped";

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
  return selection.kind === "control" ? { kind: "control", control: c(selection.control), courseControl: cc(selection.courseControl) }
    : { ...selection, from: c(selection.from), to: c(selection.to), fromCourseControl: cc(selection.fromCourseControl),
      toCourseControl: cc(selection.toCourseControl) };
}

/** Spela upp de osparade åtgärderna (eller förslaget) och historiken på en ny version. */
export function rebaseEditor(state: EditorState, input: RebaseInput): { state: EditorState; lost: LostEdit[] } {
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
  return { state: next, lost };
}

/** Sparade åtgärder (till och med löpnumret) tas bort ur loggen; dokumentet är redan detsamma som serverns. */
export function acknowledge(state: EditorState, upTo: number): EditorState {
  return state.log.some(entry => entry.seq <= upTo) ? { ...state, log: state.log.filter(entry => entry.seq > upTo) } : state;
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
}

type After = { ackedUpTo: number; authorView: CourseSettingDocument; idMap?: IdMap; rejected: readonly { seq: number; message: string }[] };

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
  }

  get version(): number { return this.serverVersion; }
  get document(): CourseSettingDocument { return this.serverDocument; }
  /** Något är inte sparat. */
  get dirty(): boolean { return this.inFlight !== undefined || this.unread !== undefined || this.unsent().length > 0; }

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
    for (let round = 0; round < 5 && !this.stopped; round += 1) {
      while (this.running) await this.running;
      if (!this.dirty && this.remoteVersion <= this.serverVersion) return;
      await this.run();
      if (this.inFlight) return; // nätet: försöker igen senare
    }
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
      const entries = this.unsent();
      if (entries.length === 0) {
        if (this.remoteVersion > this.serverVersion) await this.refresh();
        return;
      }
      let authorView = this.serverDocument;
      const replay = replayEdits(authorView, entries.map(entry => entry.edit));
      authorView = replay.document;
      this.inFlight = { entries, authorView, request: { formatVersion: 1, requestId: (this.options.newId ?? (() => crypto.randomUUID()))(),
        baseVersion: this.serverVersion, edits: entries.map(entry => entry.edit) as CourseSettingEditsRequest["edits"],
        created: entries.map(entry => ({ controls: [...entry.created.controls], courseControls: [...entry.created.courseControls],
          courses: [...entry.created.courses] })) } };
      this.sentUpTo = entries.at(-1)!.seq;
    }
    const flight = this.inFlight;
    this.options.onStatus("saving");
    let response: CourseSettingEditsSaved;
    try {
      response = await this.transport.saveEdits(flight.request);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 413) { this.inFlight = undefined; this.stopped = true; this.options.onStatus("too-large"); return; }
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
        this.stopped = true; this.options.onStatus("stopped"); return;
      }
      if (error instanceof HttpStatusError && error.status >= 400 && error.status < 500) {
        // Servern tog inte emot åtgärderna: läs om och spela upp resten utan dem.
        this.inFlight = undefined;
        await this.refresh({ ackedUpTo: flight.entries.at(-1)!.seq, authorView: this.serverDocument,
          rejected: flight.entries.map(entry => ({ seq: entry.seq, message: "Ändringen kunde inte sparas" })) });
        return;
      }
      this.options.onStatus("failed");
      this.schedule(this.retryMs);
      return;
    }
    this.inFlight = undefined;
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
        rejected: response.rejected.map(row => ({ seq: flight.entries[row.index]!.seq, message: row.message })) });
    }
    if (this.dirty || this.remoteVersion > this.serverVersion) this.schedule(this.delayMs);
    else this.options.onStatus("saved");
  }

  private async refresh(after?: After): Promise<void> {
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
    let lost: LostEdit[] = [];
    this.store.update(state => {
      const result = rebaseEditor(state, { base: after?.authorView ?? this.serverDocument, current: fetched.document, version: fetched.version,
        ackedUpTo: after?.ackedUpTo, rejected: after?.rejected, idMap: after?.idMap });
      lost = result.lost;
      return result.state;
    });
    this.serverVersion = fetched.version;
    this.serverDocument = fetched.document;
    this.sentUpTo = Math.max(this.sentUpTo, after?.ackedUpTo ?? 0);
    if (this.remoteVersion <= fetched.version) this.remoteVersion = 0;
    this.options.onVersion?.(fetched.version);
    if (lost.length > 0) this.options.onLost(lost);
    if (!this.dirty) this.options.onStatus("saved");
  }
}
