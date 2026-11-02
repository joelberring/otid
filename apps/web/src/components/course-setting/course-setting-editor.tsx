"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type {
  CourseSettingMode, CourseSettingNote, CourseSettingNoteTarget, CourseSettingState, CourseSettingSuggestionDecided
} from "@o-tid/contracts";
import {
  applyEdit, checkDocument, courseControlOrder, courseSummaries, describeControl, descriptionSymbols, layoutCoursePage, layoutOverprint, nextFreeCode,
  printAreaOf, type CourseSettingDocument, type DescriptionSymbol, type MapRect, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import type { LegAnalysis, RouteChoiceSettings } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { collaborationSv as copy } from "../../i18n/course-setting-collaboration-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import {
  browserStorage, descriptionLanguageOf, readDescriptionSettings, writeDescriptionSettings, type DescriptionSettings
} from "../../lib/course-setting-description";
import {
  createCourseSettingSuggestion, decideCourseSettingSuggestion, fetchCourseSetting, fetchCourseSettingRevision,
  importCourseSetting, replyCourseSettingNote, restoreCourseSetting, saveCourseSettingEdits, setCourseSettingMode, setCourseSettingNoteStatus
} from "../../lib/course-setting-api";
import {
  addBend, addPoint, addSplit, applySteps, beginDrag, cancelTool, canRedo, canUndo, createEditor, dragTo, endDrag, endSuggestion, insertExisting,
  redo, removeSelected, removeSplit, replaceDocument, select, setTool, setView, undo, wireCreated, type EditorState, type Tool
} from "../../lib/course-setting-editor";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { ALL_CONTROLS, hitTest, nearestBend } from "../../lib/course-setting-hit";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { noteInView, noteMarks, notePosition, noteTargetAt } from "../../lib/course-setting-note-marks";
import { previewSuggestion, suggestionOverlay } from "../../lib/course-setting-suggestion";
import { CourseSettingSync, EditorStore, type LostEdit, type SyncStatus } from "../../lib/course-setting-sync";
import { inspectedPoints, inspectionRows, mergeInspections } from "../../lib/course-setting-inspections";
import type { FieldRecord, QueuedItem } from "../../lib/course-setting-offline";
import { checkRows, controlLabel, legInput, type CheckRow } from "../../lib/course-setting-text";
import { toScreen, type Bounds, type Viewport } from "../../lib/course-setting-viewport";
import { drawPrintFrame, drawSpecialEditing } from "../../lib/course-setting-draw-special";
import { clickSpecial, finishDrawing, moveSpecialEdit, nearestHandle, specialHandles } from "../../lib/course-setting-specials";
import { PrintPanel } from "./course-setting-print-panel";
import { SpecialsPanel } from "./course-setting-specials";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchRouteChoice } from "../../lib/route-choice-api";
import { RouteChoiceSession } from "../../lib/route-choice-client";
import { describeEdit } from "../../lib/course-setting-suggestion";
import { Button, Notice } from "../ui";
import { AppearancePanel, LabelPanel } from "./course-setting-appearance";
import { CircleCuttingPanel, useDetailGaps } from "./course-setting-circle-cutting";
import { useFieldMode, useLockedPage } from "./course-setting-field";
import { FilePanel, type ReadFile } from "./course-setting-file";
import { DescriptionPanel } from "./course-setting-description";
import { InspectionsPanel, OfflinePanel } from "./course-setting-inspections";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "./course-setting-map";
import { NoteForm, NotesPanel } from "./course-setting-notes";
import { ChecksPanel, CourseList, LegPanel, SelectedPanel, SelectionCard } from "./course-setting-panels";
import { SuggestionDraft, SuggestionsPanel } from "./course-setting-suggestions";
import { TransferPanel } from "./course-setting-transfer";
import { Dialog, Drawer, ToolBar, TopBar, type DrawerTab } from "./course-setting-workspace";
import { useCourseSettingCollaboration } from "./use-course-setting-collaboration";
import { loadMapFile, useCourseSettingOffline } from "./use-course-setting-offline";
import styles from "./course-setting.module.css";

// Steg 67: styrda av service workern när sidan är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));
const createRouteWorker = () => controlledWorker(() => new Worker(new URL("../../lib/route-choice-worker.ts", import.meta.url), { type: "module" }));

/** Paketets uträkningar får inte fälla editorn; ett fel syns i konsolen och vyn visar det som går. */
function safely<T>(name: string, compute: () => T, fallback: T): T {
  try { return compute(); } catch (error) { console.error(`${name} misslyckades`, error); return fallback; }
}

type Drag = { kind: "control"; control: string; dx: number; dy: number } | { kind: "number"; courseControl: string }
  | { kind: "bend"; from: string; to: string; index: number }
  /** Steg 64: ett specialobjekt (helt eller ett hörn) och tryckytans ram. */
  | { kind: "special"; special: string; start: { x: number; y: number }; index?: number | undefined }
  | { kind: "frame"; start: { x: number; y: number }; rect: MapRect };
type LegStatus = "idle" | "waiting" | "analysing" | "failed" | "done";
type Message = { id: number; tone: "ok" | "error" | "attention"; text: string; list?: readonly string[] | undefined };

const CURSOR: Record<Tool, string> = { SELECT: "grab", ADD_CONTROL: "crosshair", ADD_START: "crosshair", ADD_FINISH: "crosshair",
  ADD_CROSSING: "crosshair", INSERT_EXISTING: "copy", ADD_BEND: "crosshair", NOTE: "cell", SPECIAL: "crosshair" };
const EDIT_TOOLS: readonly Tool[] = ["SELECT", "ADD_CONTROL", "ADD_START", "ADD_FINISH", "ADD_CROSSING", "INSERT_EXISTING", "ADD_BEND", "SPECIAL", "NOTE"];
const KEYS: Record<string, Tool> = { v: "SELECT", k: "ADD_CONTROL", s: "ADD_START", m: "ADD_FINISH", p: "ADD_CROSSING", l: "INSERT_EXISTING",
  b: "ADD_BEND", n: "NOTE", o: "SPECIAL" };
const OK_TOAST_MS = 8_000;
const STATUS_TEXT: Record<SyncStatus, string> = { saved: text.status.saved, pending: text.status.pending, saving: text.status.saving,
  failed: text.status.failed, "too-large": text.status.tooLarge, stopped: text.status.stopped };

/**
 * Steg 62 (ADR-0180) och 66 (ADR-0181): editorn. Logiken finns i `lib/course-setting-*` (editorns tillstånd, sparandet med
 * åtgärder och uppspelning, träff-test, notiser, förslag, kartvy); här kopplas den till kartan, arbetsytan, tangenterna,
 * strömmen och vägvalens Worker. Behörigheten avgör vad som går: ändra direkt (EDIT), föreslå (SUGGEST, förslagsläget)
 * eller läsa och kommentera (COMMENT).
 *
 * Steg 67 (ADR-0181 beslut 6–7): `resume` är posten i telefonen med åtgärder som väntar (eller hela läget utan nät);
 * editorn öppnas med dem och skickar dem. Kollad, notiser i fältet, kön och "Spara för offline" (`useCourseSettingOffline`).
 */
export function CourseSettingEditor({ raceId, state, notice, onReload, resume }: {
  raceId: string; state: CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> };
  notice?: string | undefined; onReload: () => void; resume?: FieldRecord | undefined;
}) {
  const access = state.access;
  const readOnly = access.level === "COMMENT";
  const initialDocument = state.setting.document as unknown as CourseSettingDocument;
  const store = useMemo(() => {
    const created = resume ? { ...createEditor(resume.document), log: resume.log, nextSeq: Math.max(0, ...resume.log.map(row => row.seq)) + 1,
      revision: 1 } : createEditor(initialDocument);
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
  const base = resume ? { version: resume.state.setting.version, document: resume.state.setting.document as unknown as CourseSettingDocument }
    : { version: state.setting.version, document: initialDocument };
  const sync = useMemo(() => new CourseSettingSync(store, base, {
    saveEdits: request => saveCourseSettingEdits(raceId, request),
    fetchSetting: async () => {
      const fresh = await fetchCourseSetting(raceId);
      if (!fresh.setting) throw new Error("Banläggningen finns inte längre");
      return { version: fresh.setting.version, document: fresh.setting.document as unknown as CourseSettingDocument };
    }
  }, {
    onStatus: setStatus, onVersion: setVersion,
    onLost: lost => say({ tone: "attention", text: copy.lost(lost.length), list: lostText(lost, store.state.document) }),
    resume: resume?.inFlight
  }), [raceId, store]);
  const resumed = useRef(false);
  useEffect(() => {
    sync.attach();
    // Steg 67: åtgärder från förra gången (ur telefonen) skickas direkt (beskedet en gång, också med Reacts dubbla körning).
    if (resume && resume.log.length > 0) {
      sync.changed();
      if (navigator.onLine && !resumed.current) say({ tone: "ok", text: offlineSv.resumed(resume.log.length) });
      resumed.current = true;
    }
    return () => sync.detach();
  }, [sync]);
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
  }, resume);

  // Steg 67: kön utan nät (notiser och bockar), åtgärderna i telefonen och "Spara för offline".
  const offline = useCourseSettingOffline({ raceId, state, store, sync, version, status, mapSha256: state.mapFile?.sha256, say,
    notes: collaboration.notes, inspections: collaboration.inspections,
    describe: (item: QueuedItem, code: number) => item.kind === "note" ? offlineSv.rejectedNote(item.request.text, code)
      : offlineSv.rejectedInspection(store.state.document.controls[item.request.control] ? controlLabel(store.state.document, item.request.control)
        : item.request.control, code),
    onSent: result => {
      if (result.sent.some(item => item.kind === "note")) void collaboration.reloadNotes();
      if (result.sent.some(item => item.kind === "inspection") || result.rejected.length > 0) void collaboration.reloadInspections();
    } });

  /** En ändring: editorns läge och sedan sparandet. */
  const apply = (change: (current: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  const edit = (change: (current: EditorState) => EditorState) => { if (!readOnly) apply(change); };

  // Kartfilen: en Worker ritar kartan, en annan räknar vägvalen.
  const [mapSession, setMapSession] = useState<MapRenderSession>();
  const [mapBounds, setMapBounds] = useState<Bounds | undefined>(state.mapFile?.bounds);
  const [mapStatus, setMapStatus] = useState<"none" | "reading" | "ready" | "failed">(state.mapFile ? "reading" : "none");
  const [georeference, setGeoreference] = useState<MapGeoreference | null>();
  const [mapBytes, setMapBytes] = useState<number>();
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
        const [file, settings] = await Promise.all([loadMapFile(raceId, state.mapFile!.sha256, offline.storage, controller.signal, () => say({
          tone: "attention", text: offlineSv.olderMap })), access.admin
          ? fetchRouteChoice(raceId, controller.signal).then(value => value.settings as RouteChoiceSettings, () => ({ version: 1 }) as RouteChoiceSettings)
          : Promise.resolve({ version: 1 } as RouteChoiceSettings)]);
        if (closed) return;
        setMapBytes(file.bytes.byteLength);
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
  // Steg 64: symbolerna för beskrivningen på kartan.
  const standard = document.event.descriptionStandard;
  const symbols = useMemo(() => symbolLookup(safely("Symbolerna", () => descriptionSymbols(standard), [] as readonly DescriptionSymbol[])), [standard]);
  const checks = useMemo(() => checkRows(document, safely("Kontrollerna", () => checkDocument(document), [])), [document]);
  const [flagged, setFlagged] = useState<CheckRow>();
  // Steg 64: sidan för vald bana (tryckytans ram på kartan i fliken Utskrift).
  const printPage = useMemo(() => {
    if (tab !== "print") return undefined;
    const page = safely("Utskriftslayouten", () => layoutCoursePage(document, { course: view, ...(variant ? { variant } : {}), mapBounds })[0], undefined);
    return page ? { page, automatic: printAreaOf(document, view).automatic || !printAreaOf(document, view).rect } : undefined;
  }, [tab, document, view, variant, mapBounds]);
  const selectedSpecial = selection?.kind === "special" ? document.specialObjects.find(item => item.id === selection.special) : undefined;
  const overlayExtra = useMemo(() => (ctx: CanvasRenderingContext2D, mapView: Viewport) => {
    const at = (point: { x: number; y: number }) => toScreen(mapView, point);
    if (printPage) drawPrintFrame(ctx, at, [printPage.page.mapArea], mapView);
    drawSpecialEditing(ctx, at, { drawing: editor.tool === "SPECIAL" ? editor.drawing : undefined, handles: selectedSpecial ? specialHandles(selectedSpecial) : undefined });
  }, [printPage, editor.tool, editor.drawing, selectedSpecial]);
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
  const input = selection?.kind === "leg" && view !== ALL_CONTROLS ? legInput(document, selection.from, selection.to, legCourseControls, view) : undefined;
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
  // Steg 67: notiser som väntar i telefonens kö visas också (märkta "väntar på nät").
  const me = { accountId: access.accountId, displayName: access.displayName };
  const pendingNotes = useMemo(() => offline.queue.flatMap((item): CourseSettingNote[] => item.kind !== "note" ? [] : [{ id: item.id,
    target: item.request.target, at: item.request.at, course: item.request.course, text: item.request.text, status: "OPEN",
    createdAt: item.createdAt, createdBy: me, resolvedAt: null, resolvedBy: null, photo: null, replies: [] }]), [offline.queue]);
  const pendingNoteIds = useMemo(() => new Set(pendingNotes.map(note => note.id)), [pendingNotes]);
  const notesInView = useMemo(() => [...collaboration.notes, ...pendingNotes].filter(note => noteInView(note, view, controlsInView)),
    [collaboration.notes, pendingNotes, view, controlsInView]);
  const mapNotes = useMemo(() => showNotes ? noteMarks(notesInView.filter(note => note.status === "OPEN" || note.id === selectedNote), document) : [],
    [showNotes, notesInView, selectedNote, document]);
  /**
   * Steg 67: en notis går alltid genom kön i telefonen (skickas direkt med nät, annars när nätet kommer). En notis på en
   * ny kontroll som inte är sparad än fästs vid punkten (kontrollens id finns inte på servern än).
   */
  async function queueNote(target: CourseSettingNoteTarget, at: { x: number; y: number } | null, value: string,
    photo: { mediaType: "image/jpeg"; base64: string } | null): Promise<void> {
    const saved = (id: string) => Boolean(sync.document.controls[id]);
    const fixed: CourseSettingNoteTarget = target.kind === "CONTROL" && !saved(target.control) && at ? { kind: "POINT", at }
      : target.kind === "LEG" && (!saved(target.from) || !saved(target.to)) && at ? { kind: "POINT", at } : target;
    await offline.enqueueNote({ requestId: crypto.randomUUID(), target: fixed, at, course: fixed.kind === "COURSE" ? fixed.course
      : view === ALL_CONTROLS ? null : view, text: value, photo });
  }
  async function saveNote(input: { text: string; photo: { mediaType: "image/jpeg"; base64: string } | null }): Promise<boolean> {
    if (!noteDraft) return false;
    try {
      await queueNote(noteDraft, notePosition({ target: noteDraft, at: null }, document) ?? null, input.text, input.photo);
      setNoteDraft(undefined);
      if (offline.offline) say({ tone: "ok", text: offlineSv.noteHere.queued });
      return true;
    } catch (error) { console.error("Notisen sparades inte i telefonen", error); return false; }
  }

  // Steg 67: kollad per kontroll – serverns bockar med de väntande i kön ovanpå.
  const inspections = useMemo(() => mergeInspections(collaboration.inspections,
    offline.queue.flatMap(item => item.kind === "inspection" ? [item.request] : []), me), [collaboration.inspections, offline.queue]);
  const inspectionList = useMemo(() => inspectionRows(document, controlsInView, inspections), [document, controlsInView, inspections]);
  const inspectedMarks = useMemo(() => inspectedPoints(document, controlsInView, inspections), [document, controlsInView, inspections]);
  const [reveal, setReveal] = useState(0);
  const [offlineDialog, setOfflineDialog] = useState(false);

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
        edits: current.log.map(entry => entry.edit) as never, created: current.log.map(entry => wireCreated(entry.created)), comment });
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
        case "SELECT":
          apply(next => select(next, target));
          if (target?.kind === "special") setTab("objects");
          return;
        case "NOTE": setNoteDraft(noteTargetAt(target, point)); setSelectedNote(undefined); return;
        case "INSERT_EXISTING": if (target && target.kind !== "leg" && target.kind !== "special") edit(next => insertExisting(next, target.control, applyEdit)); return;
        case "SPECIAL": edit(next => clickSpecial(next, point, applyEdit, tolerance * 1.5)); return;
        case "ADD_BEND":
          if (target?.kind === "leg") edit(next => addBend(select(next, target), point, applyEdit));
          else edit(next => addBend(next, point, applyEdit));
          return;
        default: edit(next => addPoint(next, current.tool, point, applyEdit, nextFreeCode));
      }
    },
    onDragStart(point, tolerance, pointerType) {
      const current = store.state;
      if (current.tool !== "SELECT" || readOnly) return false;
      const selected = current.selection;
      if (selected?.kind === "leg") {
        const index = nearestBend(current.document.legs[`${selected.from}-${selected.to}`]?.bends ?? [], point, tolerance);
        if (index !== undefined) { drag.current = { kind: "bend", from: selected.from, to: selected.to, index }; store.update(beginDrag); return true; }
      }
      // Steg 64: hörnen på valt specialobjekt, sedan objektet självt och tryckytans ram (fliken Utskrift).
      const special = selected?.kind === "special" ? current.document.specialObjects.find(item => item.id === selected.special) : undefined;
      const handle = special ? nearestHandle(special, point, tolerance) : undefined;
      if (special && handle !== undefined) { drag.current = { kind: "special", special: special.id, start: point, index: handle }; store.update(beginDrag); return true; }
      const target = hit(point, tolerance);
      if (target?.kind === "special") {
        if (pointerType === "touch" && !(selected?.kind === "special" && selected.special === target.special)) return false;
        drag.current = { kind: "special", special: target.special, start: point };
        store.update(next => beginDrag(select(next, target)));
        return true;
      }
      const frame = tab === "print" && printPage && !printPage.automatic ? printPage.page.mapArea : undefined;
      if ((!target || target.kind === "leg") && frame && point.x >= frame.minX && point.x <= frame.maxX && point.y >= frame.minY && point.y <= frame.maxY) {
        drag.current = { kind: "frame", start: point, rect: frame };
        store.update(beginDrag);
        return true;
      }
      if (!target || target.kind === "leg") return false;
      // Med fingret flyttas bara en kontroll som redan är vald (tryck först, dra sedan); annars panorerar dragningen.
      // Ägarens erfarenhet från snitslingen: det var lätt att flytta kontroller av misstag när man ville flytta kartan.
      if (pointerType === "touch" && !(selected?.kind === "control" && selected.control === target.control)) return false;
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
      else if (current.kind === "special") store.update(next => {
        const base = next.dragBase?.specialObjects.find(item => item.id === current.special);
        if (!base) return next;
        return dragTo(next, moveSpecialEdit(base, current.index !== undefined ? { index: current.index, at: point }
          : { dx: point.x - current.start.x, dy: point.y - current.start.y }), applyEdit);
      });
      else if (current.kind === "frame") store.update(next => {
        const dx = point.x - current.start.x, dy = point.y - current.start.y, rect = current.rect;
        const area = printAreaOf(next.dragBase ?? next.document, next.view);
        return dragTo(next, { type: "SET_PRINT_AREA", course: next.view, area: { ...area, automatic: false,
          rect: { minX: rect.minX + dx, maxX: rect.maxX + dx, minY: rect.minY + dy, maxY: rect.maxY + dy } } }, applyEdit);
      });
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
      else if (event.key === "Enter" && store.state.drawing?.length) { event.preventDefault(); edit(next => finishDrawing(next, applyEdit)); }
      else if (mod && key === "z") { event.preventDefault(); edit(event.shiftKey ? redo : undo); }
      else if (mod && key === "y") { event.preventDefault(); edit(redo); }
      else if (!mod && !event.altKey && key === "g") fork();
      else if (!mod && !event.altKey && KEYS[key] && (!readOnly || KEYS[key] === "SELECT" || KEYS[key] === "NOTE")) {
        if (KEYS[key] === "SPECIAL") setTab("objects");
        apply(next => setTool(next, KEYS[key]!, KEYS[key] === "SPECIAL" ? next.specialKind ?? "out-of-bounds" : undefined));
      }
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
      // Steg 64 (ADR-0183): tävlingens utskriftsprofiler och layoutmallar står inte i .ppen-filen och följer med.
      const event = document.event;
      const imported: CourseSettingDocument = { ...file.document, event: { ...file.document.event,
        ...(event.printProfiles ? { printProfiles: event.printProfiles } : {}), ...(event.printProfileId ? { printProfileId: event.printProfileId } : {}),
        ...(event.layoutTemplates ? { layoutTemplates: event.layoutTemplates } : {}) } };
      file = { ...file, document: imported };
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
  // Steg 67: utan nät (eller utloggad) säger statusen hur mycket som väntar i telefonen.
  const shownStatus = suggesting ? statusText : offline.statusText ?? statusText;
  const label = text.map(course?.name ?? text.courses.all);
  const others = collaboration.presence.filter(person => person.accountId !== access.accountId).map(person => person.displayName ?? copy.someone);
  const openSuggestions = collaboration.suggestions.filter(row => row.status === "OPEN").length;
  const openNotes = notesInView.filter(note => note.status === "OPEN").length;
  const tools = readOnly ? (["SELECT", "NOTE"] as const) : EDIT_TOOLS;
  const draft = suggesting ? <SuggestionDraft count={editor.log.length} onSend={sendSuggestion}
    onDiscard={() => store.update(next => endSuggestion(next, true))} /> : undefined;

  const panel = (() => {
    switch (tab) {
      case "courses": return <><CourseList document={document} summaries={summaries} view={view} variant={variant} readOnly={readOnly}
        onView={(next, value) => apply(current => setView(current, next, value))} onAdd={addCourse}
        onRename={(id, name) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { name } }], applyEdit))}
        onClasses={(id, classes) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { secondaryTitle: classes } }], applyEdit))}
        onRemove={id => edit(current => setView(applySteps(current, [{ type: "DELETE_COURSE", course: id }], applyEdit), ALL_CONTROLS))} />
        {/* Etiketten vid kontrollen för vald bana (ADR-0180 beslut 12). */}
        {course && <LabelPanel document={document} course={course} readOnly={readOnly} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
      </>;
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
      case "objects": return <SpecialsPanel document={document} state={editor} readOnly={readOnly}
        onKind={kind => apply(current => setTool(current, "SPECIAL", kind))} onFinish={() => edit(current => finishDrawing(current, applyEdit))}
        onCancel={() => apply(current => ({ ...current, drawing: undefined }))}
        onSelect={id => { apply(current => select(current, { kind: "special", special: id })); const found = document.specialObjects.find(item => item.id === id);
          if (found) mapHandle.current?.reveal(found.points); }}
        onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />;
      case "print": return <PrintPanel document={document} view={view} page={printPage?.page} readOnly={readOnly}
        onEdits={edits => edit(current => applySteps(current, edits, applyEdit))}
        onPreview={() => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/print?course=${encodeURIComponent(view)}`))} />;
      case "checks": return <ChecksPanel rows={checks} onShow={row => {
        setFlagged(row);
        if (row.course && document.courses.some(item => item.id === row.course)) apply(current => setView(current, row.course!));
        if (row.controls.length === 1) apply(current => select(current, { kind: "control", control: row.controls[0]! }));
        mapHandle.current?.reveal(row.controls.flatMap(id => document.controls[id] ? [document.controls[id].at] : []));
      }} />;
      case "notes": return <NotesPanel raceId={raceId} notes={notesInView} pending={pendingNoteIds} document={document} show={showNotes} onShow={setShowNotes}
        selected={selectedNote} onSelect={setSelectedNote} view={view}
        onReveal={note => { const at = notePosition(note, document); if (at) mapHandle.current?.focus(at); }}
        onReply={async (id, value) => { try { await replyCourseSettingNote(raceId, id, value); await collaboration.reloadNotes(); return true; } catch { return false; } }}
        onStatus={async (id, value) => { try { await setCourseSettingNoteStatus(raceId, id, value); await collaboration.reloadNotes(); return true; } catch { return false; } }}
        onCourseNote={() => { if (course) setNoteDraft({ kind: "COURSE", course: course.id }); }} />;
      case "inspections": return <InspectionsPanel rows={inspectionList} selected={selection?.kind === "control" ? selection.control : undefined}
        offline={offline.offline}
        onSelect={control => {
          apply(current => select(current, { kind: "control", control }));
          const at = document.controls[control]?.at;
          if (at) mapHandle.current?.focus(at);
        }} />;
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
      <OfflinePanel info={offline.mapInfo} mapSha256={state.mapFile?.sha256} mapBytes={mapBytes} busy={offline.busy} message={offline.panelMessage}
        waiting={offline.waiting} onSave={() => void offline.saveOffline()} onRemove={() => void offline.removeOffline()} onSend={offline.retry} />
      <AppearancePanel document={document} view={view} readOnly={readOnly} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />
      {!readOnly && <CircleCuttingPanel document={document} cutting={cutting} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
      </>;
    }
  })();

  // Fältläget (grenen faltlage-snabb, steg 67 bygger vidare): position, Flytta hit, pilar och Uppgifter; på smal skärm i
  // raden nertill i stället för rutan med vald kontroll.
  // Banväljaren finns i fältets rad på telefonen (raden överst har den på bredare skärm).
  const variantsByCourse = useMemo(() => Object.fromEntries(summaries.map(row => [row.course, row.variants.map(item => item.code)])), [summaries]);
  const field = useFieldMode({ raceId, state: editor, apply: edit, georeference, mapBounds, status, statusText: shownStatus, offline: offline.offline,
    readOnly, onView: (next, code) => apply(current => setView(current, next, code)), variants: variantsByCourse,
    inspection: selectedControl ? inspections.get(selectedControl) : undefined, saved: id => Boolean(sync.document.controls[id]),
    onInspect: (control, checked, position) => void offline.enqueueInspection({ formatVersion: 1, control, checked, at: new Date().toISOString(),
      position }).catch(error => console.error("Bocken sparades inte i telefonen", error)),
    onNote: ({ target, at, text: value, photo }) => queueNote(target, at, value, photo),
    onList: () => { setTab("inspections"); setReveal(value => value + 1); },
    onOffline: () => setOfflineDialog(true) });
  useLockedPage();
  const toolBar = <ToolBar tool={editor.tool} tools={tools} inCourse={view !== ALL_CONTROLS} onTool={tool => {
    if (tool === "SPECIAL") setTab("objects");
    apply(current => setTool(current, tool, tool === "SPECIAL" ? current.specialKind ?? "out-of-bounds" : undefined));
  }}
    onFork={readOnly ? undefined : fork} help={text.tools.help[editor.tool] ?? ""} />;

  const menu = [{ label: copy.topbar.fileMenu, onClick: () => setDialog("file") },
    ...(access.admin ? [{ label: copy.topbar.transfer, onClick: () => setDialog("transfer") }] : []),
    { label: copy.topbar.settings, onClick: () => setTab("settings") },
    { label: `${offlineSv.panel.heading} …`, onClick: () => setOfflineDialog(true) }];
  // `course-setting-shell` (globals.css): sidan under arbetsytan skrollar och studsar aldrig.
  return <main className={`${styles.shell} course-setting-shell`} data-version={version} data-level={access.level}
    data-field={field.narrow ? "" : undefined}>
    <TopBar raceId={raceId} document={document} summaries={summaries} view={view} variant={variant}
      onView={(next, value) => apply(current => setView(current, next, value))}
      status={<p role="status" aria-live="polite" className={styles.status} data-status={suggesting ? "pending" : offline.offline ? "failed" : status}
        data-testid="course-setting-status">{shownStatus}</p>}
      access={access.level === "EDIT" ? "" : copy.access[access.level]} presence={copy.presence(others)}
      canUndo={canUndo(editor) && !readOnly} canRedo={canRedo(editor) && !readOnly} onUndo={() => edit(undo)} onRedo={() => edit(redo)} menu={menu} />
    {/* Telefonen: verktygen och flikarna (även Objekt och Utskrift) bakom "Mer"; medan ett specialobjekt ritas syns
        verktygsraden och fliken Objekt (Klar och Avbryt). */}
    <div className={styles.stage} data-compact={field.narrow && !field.expanded && editor.tool !== "SPECIAL" ? "true" : undefined}>
      <div className={styles.mapArea}>
        <CourseSettingMap session={mapSession} mapBounds={mapBounds} primitives={primitives} faded={faded} marks={marks} analysis={analysis}
          label={label} cursor={CURSOR[editor.tool]} handlers={handlers} handle={mapHandle} noteMarks={mapNotes} selectedNote={selectedNote}
          onNoteTap={id => { setSelectedNote(id); setTab("notes"); }} suggestion={suggestionDrawing} cursorAt={cursorAt} highlightRoute={highlightRoute}
          position={field.position} inspected={inspectedMarks} onPan={field.onPan} symbols={symbols} overlayExtra={overlayExtra} cross={selection?.kind === "control" && document.controls[selection.control]
            ? { at: document.controls[selection.control]!.at, dragging: editor.dragBase !== undefined } : undefined} />
        {field.narrow ? <div className={styles.bottomStack}>
          {toolBar}
          {noteDraft && <div className={styles.cardStatic}><NoteForm target={noteDraft} document={document} onSave={saveNote} onCancel={() => setNoteDraft(undefined)} /></div>}
          <div className={styles.fieldBar} data-testid="course-setting-field">{field.bar}</div>
        </div> : <>{toolBar}<div className={styles.fieldTools}>{field.tools}</div></>}
        <div className={styles.toasts}>
          {mapStatus === "reading" && <p role="status" className={styles.toast}>{text.readingMap}</p>}
          {mapStatus === "failed" && <Notice tone="attention">{text.mapFailed}</Notice>}
          {suggesting && <p className={styles.toast} data-testid="course-setting-suggesting">{copy.suggestions.drafting}: {copy.suggestions.draftCount(editor.log.length)}
            {" "}<Button variant="quiet" onClick={() => setTab("suggestions")}>{copy.suggestions.send} …</Button></p>}
          {reviewed && <p className={styles.toast}>{copy.suggestions.reviewing}</p>}
          {editor.error && !field.narrow && <p role="alert" className={styles.toast}>{editor.error}</p>}
          {messages.map(message => <div key={message.id} className={styles.toastBox}>
            <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
              <p>{message.text}</p>
              {message.list && message.list.length > 0 && <ul>{message.list.map(row => <li key={row}>{row}</li>)}</ul>}
            </Notice>
            <Button variant="quiet" aria-label={copy.topbar.close} onClick={() => dismiss(message.id)}>×</Button>
          </div>)}
        </div>
        {field.narrow ? null : noteDraft ? <div className={styles.card}><NoteForm target={noteDraft} document={document} onSave={saveNote} onCancel={() => setNoteDraft(undefined)} /></div>
          // Rutan med vald kontroll bara med Välj: när man sätter ut kontroller eller notiser ligger den inte i vägen.
          : editor.tool === "SELECT" && <SelectionCard state={editor} described={describedControl} readOnly={readOnly}
            onCode={(control, value) => edit(current => applySteps(current, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
            onRemoveFromCourse={() => edit(current => removeSelected(current, applyEdit, false))}
            onDelete={() => edit(current => removeSelected(current, applyEdit, true))}
            onDescription={() => setTab("description")} onMore={() => setTab("selected")} onClose={() => apply(current => select(current, undefined))} />}
      </div>
      <Drawer tab={tab} onTab={setTab} reveal={reveal} counts={{ checks: checks.length, notes: openNotes,
        suggestions: openSuggestions + (suggesting ? editor.log.length : 0) }}>
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
    {offlineDialog && <Dialog title={offlineSv.panel.heading} onClose={() => setOfflineDialog(false)}>
      <OfflinePanel info={offline.mapInfo} mapSha256={state.mapFile?.sha256} mapBytes={mapBytes} busy={offline.busy} message={offline.panelMessage}
        waiting={offline.waiting} onSave={() => void offline.saveOffline()} onRemove={() => void offline.removeOffline()} onSend={offline.retry}
        heading={false} />
    </Dialog>}
    {/* Steg 67: utloggad – det som väntar ligger kvar i telefonen; efter inloggning i en ny flik skickas det (sidan försöker igen). */}
    {offline.loggedOut && <div className={styles.toasts}><Notice tone="error" role="alert"><p>{offline.waiting > 0
      ? offlineSv.loggedOut(offline.waiting) : text.status.stopped}</p>
      <div className={styles.row}><a className={styles.back} href="/konto" target="_blank" rel="noopener">{offlineSv.login}</a>
        <Button variant="secondary" onClick={offline.retry}>{offlineSv.panel.sendNow}</Button>
        <Button variant="quiet" onClick={onReload}>{text.status.reload}</Button></div></Notice></div>}
  </main>;
}
