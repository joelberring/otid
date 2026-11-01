"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CourseSettingMode, CourseSettingNoteTarget, CourseSettingState, CourseSettingSuggestionDecided } from "@o-tid/contracts";
import {
  applyEdit, checkDocument, courseControlOrder, courseSummaries, describeControl, layoutOverprint, nextFreeCode, type CourseSettingDocument,
  type OverprintPrimitive
} from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import type { LegAnalysis, RouteChoiceSettings } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { collaborationSv as copy } from "../../i18n/course-setting-collaboration-sv";
import {
  browserStorage, descriptionLanguageOf, readDescriptionSettings, writeDescriptionSettings, type DescriptionSettings
} from "../../lib/course-setting-description";
import {
  createCourseSettingNote, createCourseSettingSuggestion, decideCourseSettingSuggestion, fetchCourseSetting, fetchCourseSettingRevision,
  importCourseSetting, replyCourseSettingNote, restoreCourseSetting, saveCourseSettingEdits, setCourseSettingMode, setCourseSettingNoteStatus
} from "../../lib/course-setting-api";
import {
  addBend, addPoint, addSplit, applySteps, beginDrag, cancelTool, canRedo, canUndo, createEditor, dragTo, endDrag, endSuggestion, insertExisting,
  redo, removeSelected, removeSplit, replaceDocument, select, setTool, setView, undo, type EditorState, type Tool
} from "../../lib/course-setting-editor";
import { ALL_CONTROLS, hitTest, nearestBend } from "../../lib/course-setting-hit";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { noteInView, noteMarks, notePosition, noteTargetAt } from "../../lib/course-setting-note-marks";
import { previewSuggestion, suggestionOverlay } from "../../lib/course-setting-suggestion";
import { CourseSettingSync, EditorStore, type LostEdit, type SyncStatus } from "../../lib/course-setting-sync";
import { checkRows, legInput, type CheckRow } from "../../lib/course-setting-text";
import type { Bounds } from "../../lib/course-setting-viewport";
import { fetchMapSource, fetchRouteChoice } from "../../lib/route-choice-api";
import { RouteChoiceSession } from "../../lib/route-choice-client";
import { describeEdit } from "../../lib/course-setting-suggestion";
import { Button, Notice } from "../ui";
import { CircleCuttingPanel, useDetailGaps } from "./course-setting-circle-cutting";
import { useFieldMode, useLockedPage } from "./course-setting-field";
import { FilePanel, type ReadFile } from "./course-setting-file";
import { DescriptionPanel } from "./course-setting-description";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "./course-setting-map";
import { NoteForm, NotesPanel } from "./course-setting-notes";
import { ChecksPanel, CourseList, LegPanel, SelectedPanel, SelectionCard } from "./course-setting-panels";
import { SuggestionDraft, SuggestionsPanel } from "./course-setting-suggestions";
import { TransferPanel } from "./course-setting-transfer";
import { Dialog, Drawer, ToolBar, TopBar, type DrawerTab } from "./course-setting-workspace";
import { useCourseSettingCollaboration } from "./use-course-setting-collaboration";
import styles from "./course-setting.module.css";

const createMapWorker = () => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" });
const createRouteWorker = () => new Worker(new URL("../../lib/route-choice-worker.ts", import.meta.url), { type: "module" });

/** Paketets uträkningar får inte fälla editorn; ett fel syns i konsolen och vyn visar det som går. */
function safely<T>(name: string, compute: () => T, fallback: T): T {
  try { return compute(); } catch (error) { console.error(`${name} misslyckades`, error); return fallback; }
}

type Drag = { kind: "control"; control: string; dx: number; dy: number } | { kind: "number"; courseControl: string }
  | { kind: "bend"; from: string; to: string; index: number };
type LegStatus = "idle" | "waiting" | "analysing" | "failed" | "done";
type Message = { id: number; tone: "ok" | "error" | "attention"; text: string; list?: readonly string[] | undefined };

const CURSOR: Record<Tool, string> = { SELECT: "grab", ADD_CONTROL: "crosshair", ADD_START: "crosshair", ADD_FINISH: "crosshair",
  ADD_CROSSING: "crosshair", INSERT_EXISTING: "copy", ADD_BEND: "crosshair", NOTE: "cell" };
const EDIT_TOOLS: readonly Tool[] = ["SELECT", "ADD_CONTROL", "ADD_START", "ADD_FINISH", "ADD_CROSSING", "INSERT_EXISTING", "ADD_BEND", "NOTE"];
const KEYS: Record<string, Tool> = { v: "SELECT", k: "ADD_CONTROL", s: "ADD_START", m: "ADD_FINISH", p: "ADD_CROSSING", l: "INSERT_EXISTING",
  b: "ADD_BEND", n: "NOTE" };
const OK_TOAST_MS = 8_000;
const STATUS_TEXT: Record<SyncStatus, string> = { saved: text.status.saved, pending: text.status.pending, saving: text.status.saving,
  failed: text.status.failed, "too-large": text.status.tooLarge, stopped: text.status.stopped };

/**
 * Steg 62 (ADR-0180) och 66 (ADR-0181): editorn. Logiken finns i `lib/course-setting-*` (editorns tillstånd, sparandet med
 * åtgärder och uppspelning, träff-test, notiser, förslag, kartvy); här kopplas den till kartan, arbetsytan, tangenterna,
 * strömmen och vägvalens Worker. Behörigheten avgör vad som går: ändra direkt (EDIT), föreslå (SUGGEST, förslagsläget)
 * eller läsa och kommentera (COMMENT).
 */
export function CourseSettingEditor({ raceId, state, notice, onReload }: {
  raceId: string; state: CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> };
  notice?: string | undefined; onReload: () => void;
}) {
  const access = state.access;
  const readOnly = access.level === "COMMENT";
  const initialDocument = state.setting.document as unknown as CourseSettingDocument;
  const store = useMemo(() => {
    const created = createEditor(initialDocument);
    return new EditorStore(access.level === "SUGGEST" ? { ...created, suggesting: { base: initialDocument, baseVersion: state.setting.version } } : created);
    // Editorn monteras om (nyckeln) när dokumentet laddas om.
  }, []);
  const editor = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [status, setStatus] = useState<SyncStatus>("saved");
  const [messages, setMessages] = useState<readonly Message[]>(notice ? [{ id: 0, tone: "ok", text: notice }] : []);
  const dismiss = (id: number) => setMessages(current => current.filter(row => row.id !== id));
  /** Ett besked ovanpå kartan; de som bara bekräftar (ok utan lista) försvinner efter en stund. */
  const say = (message: Omit<Message, "id">) => {
    const id = Date.now() + Math.random();
    setMessages(current => [...current.slice(-3), { ...message, id }]);
    if (message.tone === "ok" && !message.list?.length) setTimeout(() => dismiss(id), OK_TOAST_MS);
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dismiss(0), OK_TOAST_MS);
    return () => clearTimeout(timer);
  }, []);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"file" | "transfer">();
  const [tab, setTab] = useState<DrawerTab>("courses");
  const [version, setVersion] = useState(state.setting.version);

  const lostText = (lost: readonly LostEdit[], document: CourseSettingDocument) =>
    lost.map(row => `${describeEdit(row.edit, document)}: ${row.message}`);
  const sync = useMemo(() => new CourseSettingSync(store, { version: state.setting.version, document: initialDocument }, {
    saveEdits: request => saveCourseSettingEdits(raceId, request),
    fetchSetting: async () => {
      const fresh = await fetchCourseSetting(raceId);
      if (!fresh.setting) throw new Error("Banläggningen finns inte längre");
      return { version: fresh.setting.version, document: fresh.setting.document as unknown as CourseSettingDocument };
    }
  }, {
    onStatus: setStatus, onVersion: setVersion,
    onLost: lost => say({ tone: "attention", text: copy.lost(lost.length), list: lostText(lost, store.state.document) })
  }), [raceId, store]);
  useEffect(() => { sync.attach(); return () => sync.detach(); }, [sync]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (sync.dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sync]);

  const collaboration = useCourseSettingCollaboration(raceId, state.setting.mode, (version, by) => {
    if (version <= sync.version) return;
    const name = collaboration.presence.find(person => person.accountId === by)?.displayName;
    if (by && by !== access.accountId) {
      const kept = sync.dirty || (store.state.suggesting !== undefined && store.state.log.length > 0);
      say({ tone: "ok", text: copy.remoteChanged(name ?? copy.someone, kept) });
    }
    sync.remote(version);
  });

  /** En ändring: editorns läge och sedan sparandet. */
  const apply = (change: (current: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  const edit = (change: (current: EditorState) => EditorState) => { if (!readOnly) apply(change); };

  // Kartfilen: en Worker ritar kartan, en annan räknar vägvalen.
  const [mapSession, setMapSession] = useState<MapRenderSession>();
  const [mapBounds, setMapBounds] = useState<Bounds | undefined>(state.mapFile?.bounds);
  const [mapStatus, setMapStatus] = useState<"none" | "reading" | "ready" | "failed">(state.mapFile ? "reading" : "none");
  const [georeference, setGeoreference] = useState<MapGeoreference | null>();
  const routes = useRef<RouteChoiceSession | undefined>(undefined);
  const [routeReady, setRouteReady] = useState(false);
  useEffect(() => {
    if (!state.mapFile) return;
    const controller = new AbortController();
    let closed = false;
    let session: MapRenderSession | undefined;
    void (async () => {
      try {
        // Vägvalens inställningar är admins; den som bara har banläggningen räknar med standardinställningarna.
        const [file, settings] = await Promise.all([fetchMapSource(raceId, controller.signal), access.admin
          ? fetchRouteChoice(raceId, controller.signal).then(value => value.settings as RouteChoiceSettings, () => ({ version: 1 }) as RouteChoiceSettings)
          : Promise.resolve({ version: 1 } as RouteChoiceSettings)]);
        if (closed) return;
        session = new MapRenderSession(createMapWorker, (bounds, _scale, georef) => {
          if (!closed) { setMapBounds(bounds); setGeoreference(georef); setMapStatus("ready"); }
        },
          () => { if (!closed) setMapStatus("failed"); });
        session.load(file.bytes.slice(0), file.fileName);
        setMapSession(session);
        const worker = new RouteChoiceSession(createRouteWorker);
        routes.current = worker;
        worker.load(file.bytes, file.fileName, settings, () => { if (!closed) setRouteReady(true); }, () => { if (!closed) setRouteReady(false); });
      } catch { if (!closed) setMapStatus("failed"); }
    })();
    return () => { closed = true; controller.abort(); session?.close(); routes.current?.close(); routes.current = undefined; };
  }, [raceId, state.mapFile, access.admin]);

  const { document, view, variant, selection } = editor;
  const cutting = useDetailGaps(mapSession, document);
  const options = { course: view, ...(variant ? { variant } : {}), ...cutting.options };
  const primitives = useMemo(() => safely("Banpåtrycket", () => layoutOverprint(document, options), [] as readonly OverprintPrimitive[]),
    [document, view, variant, cutting.options]);
  const faded = useMemo(() => variant ? safely("Banpåtrycket", () => layoutOverprint(document, { course: view, ...cutting.options }), [] as readonly OverprintPrimitive[]) : [],
    [document, view, variant, cutting.options]);
  const summaries = useMemo(() => safely("Banornas längder", () => courseSummaries(document), []), [document]);
  const checks = useMemo(() => checkRows(document, safely("Kontrollerna", () => checkDocument(document), [])), [document]);
  const [flagged, setFlagged] = useState<CheckRow>();
  const mapHandle = useRef<CourseSettingMapHandle>(null);
  const course = document.courses.find(row => row.id === view);
  const radiusMm = 3 * (course?.printScale ?? document.event.mapScale) / document.event.mapScale;

  const marks = useMemo(() => {
    const at = (id: string) => document.controls[id]?.at;
    const selected = selection?.kind === "control" && at(selection.control) ? [at(selection.control)!] : [];
    const leg = selection?.kind === "leg" ? document.legs[`${selection.from}-${selection.to}`] : undefined;
    const selectedLine = selection?.kind === "leg" && at(selection.from) && at(selection.to)
      ? [at(selection.from)!, ...(leg?.bends ?? []), at(selection.to)!] : undefined;
    return { selected, selectedLine, bends: leg?.bends ?? [], radiusMm,
      flagged: (flagged?.controls ?? []).flatMap(id => at(id) ? [at(id)!] : []) };
  }, [document, selection, flagged, radiusMm]);

  // Vald sträcka: vägvalen räknas om (bara den sträckan) en kort stund efter senaste ändringen; en ny ändring avbryter.
  const [analysis, setAnalysis] = useState<LegAnalysis>();
  const [legStatus, setLegStatus] = useState<LegStatus>("idle");
  const [highlighted, setHighlighted] = useState<number>();
  const legCourseControls = useMemo(() => view === ALL_CONTROLS ? [] : safely("Banans kontroller",
    () => courseControlOrder(document, view, variant), [] as readonly string[]), [document, view, variant]);
  const input = selection?.kind === "leg" && view !== ALL_CONTROLS ? legInput(document, selection.from, selection.to, legCourseControls) : undefined;
  const inputKey = input?.key;
  useEffect(() => {
    setAnalysis(undefined); setHighlighted(undefined);
    if (!input) { setLegStatus("idle"); return; }
    if (!routeReady || !routes.current) { setLegStatus("waiting"); return; }
    setLegStatus("analysing");
    const worker = routes.current;
    const timer = setTimeout(() => {
      worker.analyse([input], (_index, result) => setAnalysis(result), () => setLegStatus("done"), () => setLegStatus("failed"));
    }, 250);
    return () => { clearTimeout(timer); worker.cancel(); };
    // Nyckeln ändras med ändarnas lägen; övriga kontroller räknas med när sträckan räknas.
  }, [inputKey, routeReady]);
  const code = (id: string, end: "S" | "F") => document.controls[id]?.kind === "NORMAL" ? `${document.controls[id].code ?? "?"}.1` : end;
  const legKey = selection?.kind === "leg" && view !== ALL_CONTROLS ? `${code(selection.from, "S")}-${code(selection.to, "F")}` : undefined;
  const routeRows = analysis?.best ? [analysis.best, ...analysis.alternatives] : [];
  const highlightRoute = highlighted !== undefined ? routeRows[highlighted]?.points : undefined;

  // Notiser (ADR-0181 beslut 1): markeringar som går att dölja, en ny fästs med verktyget Notis.
  const [showNotes, setShowNotes] = useState(true);
  const [selectedNote, setSelectedNote] = useState<string>();
  const [noteDraft, setNoteDraft] = useState<CourseSettingNoteTarget>();
  const controlsInView = useMemo(() => new Set(view === ALL_CONTROLS ? Object.keys(document.controls)
    : legCourseControls.map(id => document.courseControls[id]?.control).filter((id): id is string => id !== undefined)), [document, view, legCourseControls]);
  const notesInView = useMemo(() => collaboration.notes.filter(note => noteInView(note, view, controlsInView)), [collaboration.notes, view, controlsInView]);
  const mapNotes = useMemo(() => showNotes ? noteMarks(notesInView.filter(note => note.status === "OPEN" || note.id === selectedNote), document) : [],
    [showNotes, notesInView, selectedNote, document]);
  async function saveNote(input: { text: string; photo: { mediaType: "image/jpeg"; base64: string } | null }): Promise<boolean> {
    if (!noteDraft) return false;
    try {
      const note = await createCourseSettingNote(raceId, { requestId: crypto.randomUUID(), target: noteDraft,
        at: notePosition({ target: noteDraft, at: null }, document) ?? null, course: noteDraft.kind === "COURSE" ? noteDraft.course
          : view === ALL_CONTROLS ? null : view, text: input.text, photo: input.photo });
      setNoteDraft(undefined); setSelectedNote(note.id);
      await collaboration.reloadNotes();
      return true;
    } catch (error) { console.error("Notisen sparades inte", error); return false; }
  }

  // Förslag (ADR-0181 beslut 3): granskas ovanpå banan, godkänns helt eller delvis eller avböjs.
  const [reviewing, setReviewing] = useState<string>();
  const [skip, setSkip] = useState<ReadonlySet<number>>(new Set());
  const [decision, setDecision] = useState<{ suggestion: string; decided: CourseSettingSuggestionDecided } | { suggestion: string; failed: true }>();
  const reviewed = collaboration.suggestions.find(row => row.id === reviewing);
  const preview = useMemo(() => reviewed ? safely("Förslaget", () => previewSuggestion(document, reviewed, skip), undefined) : undefined,
    [reviewed, document, skip]);
  const suggestionDrawing = useMemo(() => {
    if (!preview) return undefined;
    const overlay = suggestionOverlay(document, preview.document);
    return { ...overlay, primitives: safely("Förslagets banpåtryck", () => layoutOverprint(preview.document, options), [] as readonly OverprintPrimitive[]),
      radiusMm };
  }, [preview, document, view, variant, radiusMm]);
  const rejectedInPreview = useMemo(() => new Set(preview?.rejected.map(row => row.index) ?? []), [preview]);
  async function decide(id: string, choice: "APPROVE" | "DECLINE", comment: string) {
    try {
      await sync.flush();
      const decided = await decideCourseSettingSuggestion(raceId, id, { decision: choice, ...(choice === "APPROVE" ? { skip: [...skip] } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setDecision({ suggestion: id, decided });
      if (decided.saved && decided.saved.applied > 0) sync.remote(decided.saved.version);
      setSkip(new Set());
      await collaboration.reloadSuggestions();
    } catch (error) { console.error("Beslutet sparades inte", error); setDecision({ suggestion: id, failed: true }); }
  }
  async function sendSuggestion(comment: string): Promise<boolean> {
    const current = store.state;
    if (!current.suggesting || current.log.length === 0) return false;
    try {
      await createCourseSettingSuggestion(raceId, { requestId: crypto.randomUUID(), baseVersion: current.suggesting.baseVersion,
        edits: current.log.map(entry => entry.edit) as never, created: current.log.map(entry => ({ controls: [...entry.created.controls],
          courseControls: [...entry.created.courseControls], courses: [...entry.created.courses] })), comment });
      store.update(next => endSuggestion(next, true));
      await collaboration.reloadSuggestions();
      return true;
    } catch (error) { console.error("Förslaget skickades inte", error); return false; }
  }

  const drag = useRef<Drag | undefined>(undefined);
  const hit = (point: { x: number; y: number }, tolerance: number) => hitTest(store.state.document, store.state.view, primitives, point, tolerance);
  const handlers: MapPointerHandlers = {
    onTap(point, tolerance) {
      const current = store.state;
      const target = hit(point, tolerance);
      setFlagged(undefined);
      switch (current.tool) {
        case "SELECT": apply(next => select(next, target)); return;
        case "NOTE": setNoteDraft(noteTargetAt(target, point)); setSelectedNote(undefined); return;
        case "INSERT_EXISTING": if (target && target.kind !== "leg") edit(next => insertExisting(next, target.control, applyEdit)); return;
        case "ADD_BEND":
          if (target?.kind === "leg") edit(next => addBend(select(next, target), point, applyEdit));
          else edit(next => addBend(next, point, applyEdit));
          return;
        default: edit(next => addPoint(next, current.tool, point, applyEdit, nextFreeCode));
      }
    },
    onDragStart(point, tolerance) {
      const current = store.state;
      if (current.tool !== "SELECT" || readOnly) return false;
      const selected = current.selection;
      if (selected?.kind === "leg") {
        const index = nearestBend(current.document.legs[`${selected.from}-${selected.to}`]?.bends ?? [], point, tolerance);
        if (index !== undefined) { drag.current = { kind: "bend", from: selected.from, to: selected.to, index }; store.update(beginDrag); return true; }
      }
      const target = hit(point, tolerance);
      if (!target || target.kind === "leg") return false;
      if (target.kind === "number" && target.courseControl && current.view !== ALL_CONTROLS) drag.current = { kind: "number", courseControl: target.courseControl };
      else {
        const at = current.document.controls[target.control]!.at;
        drag.current = { kind: "control", control: target.control, dx: at.x - point.x, dy: at.y - point.y };
      }
      store.update(next => beginDrag(select(next, target)));
      return true;
    },
    onDragMove(point) {
      const current = drag.current;
      if (!current) return;
      if (current.kind === "control") store.update(next => dragTo(next, { type: "MOVE_CONTROL", control: current.control,
        at: { x: point.x + current.dx, y: point.y + current.dy } }, applyEdit));
      else if (current.kind === "number") store.update(next => dragTo(next, { type: "MOVE_NUMBER", course: next.view, courseControl: current.courseControl, at: point }, applyEdit));
      else store.update(next => {
        const bends = [...(next.dragBase?.legs[`${current.from}-${current.to}`]?.bends ?? [])];
        bends[current.index] = point;
        return dragTo(next, { type: "SET_LEG_BENDS", from: current.from, to: current.to, bends }, applyEdit);
      });
    },
    onDragEnd() { drag.current = undefined; apply(endDrag); sync.poke(); }
  };
  const cursorAt = (point: { x: number; y: number }, tolerance: number) => {
    if (store.state.tool !== "SELECT") return undefined;
    const target = hit(point, tolerance);
    return target ? (readOnly ? "pointer" : target.kind === "leg" ? "pointer" : "move") : "grab";
  };
  const fork = () => {
    const at = store.state.selection?.kind === "control" ? store.state.selection.courseControl : undefined;
    if (!at || store.state.view === ALL_CONTROLS) { say({ tone: "attention", text: text.tools.forkNeedsSelection }); return; }
    edit(next => addSplit(next, "FORK", 2, applyEdit));
  };

  // Tangenterna (inte när man skriver i ett fält): verktygen med en bokstav, Delete, Escape, ångra och gör om.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true'], dialog"))) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); edit(next => removeSelected(next, applyEdit)); }
      else if (event.key === "Escape") { apply(cancelTool); setNoteDraft(undefined); }
      else if (mod && key === "z") { event.preventDefault(); edit(event.shiftKey ? redo : undo); }
      else if (mod && key === "y") { event.preventDefault(); edit(redo); }
      else if (!mod && !event.altKey && key === "g") fork();
      else if (!mod && !event.altKey && KEYS[key] && (!readOnly || KEYS[key] === "SELECT" || KEYS[key] === "NOTE")) apply(next => setTool(next, KEYS[key]!));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [readOnly]);

  /** Ett dokument från servern (inläsning, återställning): historiken börjar om och sparandet bygger på dess version. */
  function fromServer(next: CourseSettingDocument, version: number) {
    store.update(current => replaceDocument(current, next, version));
    sync.reset(version, next);
  }

  async function flush(): Promise<boolean> {
    await sync.flush();
    return !sync.dirty;
  }

  async function onImport(file: ReadFile) {
    if (!window.confirm(text.file.replaceConfirm)) return;
    setBusy(true);
    try {
      await sync.flush();
      const outcome = await importCourseSetting(raceId, { document: file.document, expectedVersion: sync.version, fileName: file.fileName, ppen: file.ppen });
      if (outcome.kind === "conflict") { say({ tone: "error", text: text.status.conflict }); sync.remote(outcome.conflict.current?.version ?? sync.version + 1); return; }
      if (outcome.kind === "too-large") { say({ tone: "error", text: text.file.tooLarge }); return; }
      fromServer(file.document, outcome.version);
      say({ tone: "ok", text: text.file.imported(file.document.courses.length, Object.keys(file.document.controls).length),
        list: file.warnings.map(warning => warning.text) });
    } catch { say({ tone: "error", text: text.file.failed }); } finally { setBusy(false); }
  }

  async function onRestore(version: number): Promise<boolean> {
    setBusy(true);
    try {
      await sync.flush();
      const outcome = await restoreCourseSetting(raceId, sync.version, version);
      if (outcome.kind !== "saved") { if (outcome.kind === "conflict") sync.remote(outcome.conflict.current?.version ?? sync.version + 1); return false; }
      const revision = await fetchCourseSettingRevision(raceId, version);
      fromServer(revision.document as unknown as CourseSettingDocument, outcome.version);
      return true;
    } catch { return false; } finally { setBusy(false); }
  }

  function addCourse(name: string) {
    edit(current => {
      const next = applySteps(current, [{ type: "ADD_COURSE", name }], applyEdit);
      const created = next.document.courses.find(row => !current.document.courses.some(old => old.id === row.id));
      return created ? setView(next, created.id) : next;
    });
  }

  async function changeMode(mode: CourseSettingMode) {
    try { collaboration.setMode(await setCourseSettingMode(raceId, mode)); say({ tone: "ok", text: copy.mode.saved }); }
    catch { say({ tone: "error", text: copy.mode.failed }); }
  }

  // Steg 63: beskrivningens språk (i dokumentet) och visningssätt (i webbläsaren per tävling), vald kontrolls beskrivning i text.
  const router = useRouter();
  const [descriptionKind, setDescriptionKind] = useState<DescriptionSettings["kind"]>(() =>
    readDescriptionSettings(browserStorage(), raceId, initialDocument).kind);
  const descriptionSettings = useMemo<DescriptionSettings>(() => ({ language: descriptionLanguageOf(document), kind: descriptionKind }),
    [document, descriptionKind]);
  const selectedControl = selection?.kind === "control" ? selection.control : undefined;
  const describedControl = useMemo(() => selectedControl
    ? safely("Textbeskrivningen", () => describeControl(document, selectedControl, descriptionSettings.language), "") : "",
  [document, selectedControl, descriptionSettings.language]);

  const suggesting = editor.suggesting !== undefined;
  const statusText = suggesting ? copy.suggestions.draftCount(editor.log.length) : STATUS_TEXT[status];
  const label = text.map(course?.name ?? text.courses.all);
  const others = collaboration.presence.filter(person => person.accountId !== access.accountId).map(person => person.displayName ?? copy.someone);
  const openSuggestions = collaboration.suggestions.filter(row => row.status === "OPEN").length;
  const openNotes = notesInView.filter(note => note.status === "OPEN").length;
  const tools = readOnly ? (["SELECT", "NOTE"] as const) : EDIT_TOOLS;
  const draft = suggesting ? <SuggestionDraft count={editor.log.length} onSend={sendSuggestion}
    onDiscard={() => store.update(next => endSuggestion(next, true))} /> : undefined;

  const panel = (() => {
    switch (tab) {
      case "courses": return <CourseList document={document} summaries={summaries} view={view} variant={variant} readOnly={readOnly}
        onView={(next, value) => apply(current => setView(current, next, value))} onAdd={addCourse}
        onRename={(id, name) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { name } }], applyEdit))}
        onClasses={(id, classes) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { secondaryTitle: classes } }], applyEdit))}
        onRemove={id => edit(current => setView(applySteps(current, [{ type: "DELETE_COURSE", course: id }], applyEdit), ALL_CONTROLS))} />;
      case "description": return <DescriptionPanel document={document} view={view} variant={variant} selection={selection} settings={descriptionSettings}
        onSettings={next => {
          setDescriptionKind(next.kind);
          writeDescriptionSettings(browserStorage(), raceId, next);
          if (next.language !== descriptionSettings.language) {
            edit(current => applySteps(current, [{ type: "SET_EVENT", changes: { descriptionLanguage: next.language } }], applyEdit));
          }
        }}
        onSelect={target => apply(current => select(current, target))}
        onEdit={edits => edit(current => applySteps(current, edits, applyEdit))}
        onPrint={() => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/descriptions`))} />;
      case "selected": return <>
        <SelectedPanel state={editor} described={describedControl} readOnly={readOnly}
          onCode={(control, value) => edit(current => applySteps(current, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
          onRemoveFromCourse={() => edit(current => removeSelected(current, applyEdit, false))}
          onDelete={() => edit(current => removeSelected(current, applyEdit, true))}
          onSplit={(kind, branches) => edit(current => addSplit(current, kind, branches, applyEdit))}
          onRemoveSplit={() => edit(current => removeSplit(current, applyEdit))}
          onResetNumber={() => edit(current => current.selection?.kind === "control" && current.selection.courseControl
            ? applySteps(current, [{ type: "MOVE_NUMBER", course: current.view, courseControl: current.selection.courseControl, at: null }], applyEdit) : current)}
          onStraighten={() => edit(current => removeSelected(current, applyEdit))} />
        <LegPanel legKey={legKey} analysis={analysis} status={legStatus} highlighted={highlighted} onHighlight={setHighlighted} />
      </>;
      case "checks": return <ChecksPanel rows={checks} onShow={row => {
        setFlagged(row);
        if (row.course && document.courses.some(item => item.id === row.course)) apply(current => setView(current, row.course!));
        if (row.controls.length === 1) apply(current => select(current, { kind: "control", control: row.controls[0]! }));
        mapHandle.current?.reveal(row.controls.flatMap(id => document.controls[id] ? [document.controls[id].at] : []));
      }} />;
      case "notes": return <NotesPanel raceId={raceId} notes={notesInView} document={document} show={showNotes} onShow={setShowNotes}
        selected={selectedNote} onSelect={setSelectedNote} view={view}
        onReveal={note => { const at = notePosition(note, document); if (at) mapHandle.current?.focus(at); }}
        onReply={async (id, value) => { try { await replyCourseSettingNote(raceId, id, value); await collaboration.reloadNotes(); return true; } catch { return false; } }}
        onStatus={async (id, value) => { try { await setCourseSettingNoteStatus(raceId, id, value); await collaboration.reloadNotes(); return true; } catch { return false; } }}
        onCourseNote={() => { if (course) setNoteDraft({ kind: "COURSE", course: course.id }); }} />;
      case "suggestions": return <SuggestionsPanel suggestions={collaboration.suggestions} document={document} reviewing={reviewing}
        onReview={id => { setReviewing(id); setSkip(new Set()); setDecision(undefined); }} skip={skip} onSkip={setSkip}
        canDecide={access.level === "EDIT"} onDecide={decide} result={decision} rejected={rejectedInPreview} draft={draft} />;
      // Inställningar: arbetssättet och ringklippen (ADR-0180 beslut 10).
      case "settings": return <><section className={styles.panel} aria-labelledby="course-setting-mode">
        <h2 id="course-setting-mode">{copy.mode.heading}</h2>
        <label className={styles.stack}>{copy.mode.label}
          <select value={collaboration.mode} disabled={!access.admin} onChange={event => void changeMode(event.target.value === "SHARED" ? "SHARED" : "LEAD")}>
            <option value="LEAD">{copy.mode.LEAD}</option><option value="SHARED">{copy.mode.SHARED}</option>
          </select></label>
        <p className={styles.muted}>{copy.mode.help[collaboration.mode]}</p>
        <p className={styles.muted}>{copy.access[access.level]}</p>
        <p className={styles.muted}>{text.tools.keys}</p>
      </section>
      {!readOnly && <CircleCuttingPanel document={document} cutting={cutting} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
      </>;
    }
  })();

  // Fältläget (grenen faltlage-snabb, steg 67 bygger vidare): position, Flytta hit, pilar och Uppgifter; på smal skärm i
  // raden nertill i stället för rutan med vald kontroll.
  // Banväljaren finns i fältets rad på telefonen (raden överst har den på bredare skärm).
  const variantsByCourse = useMemo(() => Object.fromEntries(summaries.map(row => [row.course, row.variants.map(item => item.code)])), [summaries]);
  const field = useFieldMode({ raceId, state: editor, apply: edit, georeference, mapBounds, status, statusText, version: () => sync.version,
    onView: (next, code) => apply(current => setView(current, next, code)), variants: variantsByCourse });
  useLockedPage();
  const toolBar = <ToolBar tool={editor.tool} tools={tools} inCourse={view !== ALL_CONTROLS} onTool={tool => apply(current => setTool(current, tool))}
    onFork={readOnly ? undefined : fork} help={text.tools.help[editor.tool] ?? ""} />;

  const menu = [{ label: copy.topbar.fileMenu, onClick: () => setDialog("file") },
    ...(access.admin ? [{ label: copy.topbar.transfer, onClick: () => setDialog("transfer") }] : []),
    { label: copy.topbar.settings, onClick: () => setTab("settings") }];
  // `course-setting-shell` (globals.css): sidan under arbetsytan skrollar och studsar aldrig.
  return <main className={`${styles.shell} course-setting-shell`} data-version={version} data-level={access.level}
    data-field={field.narrow && !readOnly ? "" : undefined}>
    <TopBar raceId={raceId} document={document} summaries={summaries} view={view} variant={variant}
      onView={(next, value) => apply(current => setView(current, next, value))}
      status={<p role="status" aria-live="polite" className={styles.status} data-status={suggesting ? "pending" : status}
        data-testid="course-setting-status">{statusText}</p>}
      access={access.level === "EDIT" ? "" : copy.access[access.level]} presence={copy.presence(others)}
      canUndo={canUndo(editor) && !readOnly} canRedo={canRedo(editor) && !readOnly} onUndo={() => edit(undo)} onRedo={() => edit(redo)} menu={menu} />
    <div className={styles.stage}>
      <div className={styles.mapArea}>
        <CourseSettingMap session={mapSession} mapBounds={mapBounds} primitives={primitives} faded={faded} marks={marks} analysis={analysis}
          label={label} cursor={CURSOR[editor.tool]} handlers={handlers} handle={mapHandle} noteMarks={mapNotes} selectedNote={selectedNote}
          onNoteTap={id => { setSelectedNote(id); setTab("notes"); }} suggestion={suggestionDrawing} cursorAt={cursorAt} highlightRoute={highlightRoute}
          position={field.position} cross={selection?.kind === "control" && document.controls[selection.control]
            ? { at: document.controls[selection.control]!.at, dragging: editor.dragBase !== undefined } : undefined} />
        {field.narrow ? <div className={styles.bottomStack}>
          {toolBar}
          {noteDraft && <div className={styles.cardStatic}><NoteForm target={noteDraft} document={document} onSave={saveNote} onCancel={() => setNoteDraft(undefined)} /></div>}
          {!readOnly && <div className={styles.fieldBar} data-testid="course-setting-field">{field.bar}</div>}
        </div> : <>{toolBar}{!readOnly && <div className={styles.fieldTools}>{field.tools}</div>}</>}
        <div className={styles.toasts}>
          {mapStatus === "reading" && <p role="status" className={styles.toast}>{text.readingMap}</p>}
          {mapStatus === "failed" && <Notice tone="attention">{text.mapFailed}</Notice>}
          {suggesting && <p className={styles.toast} data-testid="course-setting-suggesting">{copy.suggestions.drafting}: {copy.suggestions.draftCount(editor.log.length)}
            {" "}<Button variant="quiet" onClick={() => setTab("suggestions")}>{copy.suggestions.send} …</Button></p>}
          {reviewed && <p className={styles.toast}>{copy.suggestions.reviewing}</p>}
          {editor.error && !field.narrow && <p role="alert" className={styles.toast}>{editor.error}</p>}
          {field.notice}
          {messages.map(message => <div key={message.id} className={styles.toastBox}>
            <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
              <p>{message.text}</p>
              {message.list && message.list.length > 0 && <ul>{message.list.map(row => <li key={row}>{row}</li>)}</ul>}
            </Notice>
            <Button variant="quiet" aria-label={copy.topbar.close} onClick={() => dismiss(message.id)}>×</Button>
          </div>)}
        </div>
        {field.narrow && !readOnly ? null : noteDraft ? <div className={styles.card}><NoteForm target={noteDraft} document={document} onSave={saveNote} onCancel={() => setNoteDraft(undefined)} /></div>
          : <SelectionCard state={editor} described={describedControl} readOnly={readOnly}
            onCode={(control, value) => edit(current => applySteps(current, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
            onRemoveFromCourse={() => edit(current => removeSelected(current, applyEdit, false))}
            onDelete={() => edit(current => removeSelected(current, applyEdit, true))}
            onDescription={() => setTab("description")} onMore={() => setTab("selected")} onClose={() => apply(current => select(current, undefined))} />}
      </div>
      <Drawer tab={tab} onTab={setTab} counts={{ checks: checks.length, notes: openNotes, suggestions: openSuggestions + (suggesting ? editor.log.length : 0) }}>
        {panel}
      </Drawer>
    </div>
    {dialog === "file" && <Dialog title={text.file.heading} onClose={() => setDialog(undefined)}>
      <FilePanel raceId={raceId} document={document} original={state.original} busy={busy || access.level !== "EDIT"} onImport={onImport}
        onRestore={onRestore} />
    </Dialog>}
    {dialog === "transfer" && access.admin && <Dialog title={text.transfer.heading} onClose={() => setDialog(undefined)}>
      <TransferPanel raceId={raceId} ready={!busy && status !== "too-large"} flush={flush} version={() => sync.version} />
    </Dialog>}
    {status === "stopped" && <div className={styles.toasts}><Notice tone="error" role="alert"><p>{text.status.stopped}</p>
      <Button variant="secondary" onClick={onReload}>{text.status.reload}</Button></Notice></div>}
  </main>;
}
