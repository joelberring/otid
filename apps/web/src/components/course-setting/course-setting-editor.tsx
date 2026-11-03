"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type {
  CourseSettingMode, CourseSettingState, CourseSettingSuggestionDecided
} from "@o-tid/contracts";
import {
  acceptChecksEdit, applyEdit, carryExcludedVariants, courseControlOrder, courseSummaries, describeControl, descriptionSymbols,
  keepAcceptedChecks, keepPaperOnImport, layoutCoursePage, layoutOverprint, nextFreeCode, printAreaOf, unacceptChecksEdit, type CourseSettingDocument,
  type DescriptionSymbol, type MapRect, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import type { LegAnalysis } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { collaborationSv as copy } from "../../i18n/course-setting-collaboration-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import {
  browserStorage, descriptionLanguageOf, readDescriptionSettings, writeDescriptionSettings, type DescriptionSettings
} from "../../lib/course-setting-description";
import {
  createCourseSettingSuggestion, decideCourseSettingSuggestion, fetchCourseSetting, fetchCourseSettingRevision,
  importCourseSetting, restoreCourseSetting, saveCourseSettingEdits, setCourseSettingMode
} from "../../lib/course-setting-api";
import {
  addBend, addPoint, addSplit, applySteps, beginDrag, cancelTool, canRedo, canUndo, createEditor, dragTo, endDrag, endSuggestion, insertExisting,
  redo, removeSelected, removeSplit, replaceDocument, select, setTool, setView, undo, wireCreated, type EditorState, type Tool
} from "../../lib/course-setting-editor";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { ALL_CONTROLS, hitTest, nearestBend } from "../../lib/course-setting-hit";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { noteTargetAt } from "../../lib/course-setting-note-marks";
import { previewSuggestion, suggestionOverlay } from "../../lib/course-setting-suggestion";
import { failedNames, safely } from "../../lib/course-setting-safely";
import { CourseSettingSync, EditorStore, type LostEdit, type SyncStatus } from "../../lib/course-setting-sync";
import { inspectedPoints, inspectionRows, mergeInspections } from "../../lib/course-setting-inspections";
import type { FieldRecord, QueuedItem } from "../../lib/course-setting-offline";
import { controlLabel, legInput } from "../../lib/course-setting-text";
import { legForbiddenNotice, showCheckRow, type CheckRow } from "../../lib/course-setting-checks";
import { toScreen, type Bounds, type Viewport } from "../../lib/course-setting-viewport";
import { drawPrintFrame, drawSpecialEditing } from "../../lib/course-setting-draw-special";
import { clickSpecial, finishDrawing, moveSpecialEdit, nearestHandle, specialHandles } from "../../lib/course-setting-specials";
import { PrintPanel } from "./course-setting-print-panel";
import { SpecialsPanel } from "./course-setting-specials";
import { controlledWorker } from "../../lib/course-setting-worker";
import { describeEdit } from "../../lib/course-setting-suggestion";
import { Button, Notice } from "../ui";
import { AppearancePanel, LabelPanel } from "./course-setting-appearance";
import { CircleCuttingPanel, useDetailGaps } from "./course-setting-circle-cutting";
import { useFieldMode, useLockedPage } from "./course-setting-field";
import { FilePanel, type ReadFile } from "./course-setting-file";
import { importedImageHashes } from "../../lib/course-setting-paper-api";
import { DescriptionPanel } from "./course-setting-description";
import { FieldSuggestionLine, useDescriptionSuggestions } from "./course-setting-suggest";
import { drawSuggestionHighlight } from "../../lib/course-setting-suggest";
import { InspectionsPanel, OfflinePanel } from "./course-setting-inspections";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "./course-setting-map";
import { CourseList, LegPanel, SelectedPanel, SelectionCard } from "./course-setting-panels";
import { ChecksPanel, useForbiddenRouteRunner, useForbiddenRoutes } from "./course-setting-checks";
import { SuggestionDraft, SuggestionsPanel } from "./course-setting-suggestions";
import { TransferPanel } from "./course-setting-transfer";
import { canTransfer, newCourseKind, RaceTypeHint } from "./course-setting-race-type";
import { courseSettingHelpViews, Dialog, Drawer, ToolBar, TopBar, type DrawerTab } from "./course-setting-workspace";
import { useCourseSettingCollaboration } from "./use-course-setting-collaboration";
import { ControlList } from "./course-setting-controls";
import { CourseProperties } from "./course-setting-course-properties";
import { RouteLengthPanel, useRouteLength, useRouteResults } from "./course-setting-route-length";
import { VariantsPanel } from "./course-setting-variants";
import { moveCourseEdit } from "../../lib/course-setting-properties";
import { useCourseSettingUx } from "./use-course-setting-ux";
import { useCourseSettingHistory } from "./use-course-setting-history";
import { rejectedNoteText, useCourseSettingNotes } from "./use-course-setting-notes";
import { loadMapFile, useCourseSettingOffline } from "./use-course-setting-offline";
import { useRouteChoiceWorker } from "./use-route-choice-worker";
import { useCourseSettingTraining } from "./use-course-setting-training";
import { useMoveShared } from "./course-setting-move-shared";
import styles from "./course-setting.module.css";

// Steg 67: styrda av service workern när sidan är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));


type Drag = { kind: "control"; control: string; dx: number; dy: number; courseControl?: string | undefined } | { kind: "number"; courseControl: string } | { kind: "rotate" }
  | { kind: "bend"; from: string; to: string; index: number }
  /** Steg 64: ett specialobjekt (helt eller ett hörn) och tryckytans ram. */
  | { kind: "special"; special: string; start: { x: number; y: number }; index?: number | undefined }
  | { kind: "frame"; start: { x: number; y: number }; rect: MapRect };
type LegStatus = "idle" | "waiting" | "analysing" | "failed" | "done";
type Message = { id: number; tone: "ok" | "error" | "attention"; text: string; list?: readonly string[] | undefined };

const CURSOR: Record<Tool, string> = { SELECT: "grab", ADD_CONTROL: "crosshair", ADD_START: "crosshair", ADD_FINISH: "crosshair",
  ADD_CROSSING: "crosshair", INSERT_EXISTING: "copy", ADD_BEND: "crosshair", NOTE: "cell", SPECIAL: "crosshair", ADD_MAP_EXCHANGE: "crosshair" };
const EDIT_TOOLS: readonly Tool[] = ["SELECT", "ADD_CONTROL", "ADD_START", "ADD_FINISH", "ADD_CROSSING", "INSERT_EXISTING", "ADD_BEND", "SPECIAL", "NOTE"];
const KEYS: Record<string, Tool> = { v: "SELECT", k: "ADD_CONTROL", s: "ADD_START", m: "ADD_FINISH", p: "ADD_CROSSING", l: "INSERT_EXISTING",
  b: "ADD_BEND", n: "NOTE", o: "SPECIAL" };
const OK_TOAST_MS = 8_000;
const STATUS_TEXT: Record<SyncStatus, string> = { saved: text.status.saved, pending: text.status.pending, saving: text.status.saving,
  failed: text.status.failed, stopped: text.status.stopped };

/**
 * Steg 62 (ADR-0180) och 66 (ADR-0181): editorn. Logiken finns i `lib/course-setting-*` (editorns tillstånd, sparandet med
 * åtgärder och uppspelning, träff-test, notiser, förslag, kartvy); här kopplas den till kartan, arbetsytan, tangenterna,
 * strömmen och vägvalens Worker. Behörigheten avgör vad som går: ändra direkt (EDIT), föreslå (SUGGEST, förslagsläget)
 * eller läsa och kommentera (COMMENT).
 *
 * Steg 67 (ADR-0181 beslut 6–7): `resume` är posten i telefonen med åtgärder som väntar (eller hela läget utan nät);
 * editorn öppnas med dem och skickar dem. Kollad, notiser i fältet, kön och "Spara för offline" (`useCourseSettingOffline`).
 */
export function CourseSettingEditor({ raceId, state, notice, noticeStays, onReload, resume }: {
  raceId: string; state: CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> };
  /** Beskedet står kvar tills det stängs (varianter ur banfilen som blev egna banor). */
  notice?: string | undefined; noticeStays?: boolean | undefined; onReload: () => void; resume?: FieldRecord | undefined;
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
  const [messages, setMessages] = useState<readonly Message[]>(notice ? [{ id: 0, tone: noticeStays ? "attention" : "ok", text: notice }] : []);
  const dismiss = (id: number) => setMessages(current => current.filter(row => row.id !== id));
  /** Ett besked ovanpå kartan; de som bara bekräftar (ok utan lista) försvinner efter en stund. */
  const say = (message: Omit<Message, "id">) => {
    const id = Date.now() + Math.random();
    setMessages(current => [...current.slice(-3), { ...message, id }]);
    if (message.tone === "ok" && !message.list?.length) setTimeout(() => dismiss(id), OK_TOAST_MS);
  };
  useEffect(() => {
    if (!notice || noticeStays) return;
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
    onAccessGone: () => { say({ tone: "error", text: offlineSv.accessGone }); onReload(); },
    describe: (item: QueuedItem, code: number) => item.kind !== "inspection" ? rejectedNoteText(item, code)
      : offlineSv.rejectedInspection(store.state.document.controls[item.request.control] ? controlLabel(store.state.document, item.request.control)
        : item.request.control, code),
    onSent: result => {
      if (result.sent.some(item => item.kind !== "inspection")) void collaboration.reloadNotes();
      if (result.sent.some(item => item.kind === "inspection") || result.rejected.length > 0) void collaboration.reloadInspections();
    } });

  // ADR-0190: ångra efter omladdning (egna steg, i telefonen för sessionen).
  useCourseSettingHistory({ raceId, accountId: access.accountId, store, storage: offline.storage, enabled: access.level === "EDIT", say });

  /** En ändring: editorns läge och sedan sparandet. */
  const apply = (change: (current: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  const edit = (change: (current: EditorState) => EditorState) => { if (!readOnly) apply(change); };

  // Kartfilen: en Worker ritar kartan; vägvalens Worker startas först när en sträcka väljs (`useRouteChoiceWorker`).
  const [mapSession, setMapSession] = useState<MapRenderSession>();
  const [mapBounds, setMapBounds] = useState<Bounds | undefined>(state.mapFile?.bounds);
  const [mapStatus, setMapStatus] = useState<"none" | "reading" | "ready" | "failed">(state.mapFile ? "reading" : "none");
  const [georeference, setGeoreference] = useState<MapGeoreference | null>();
  const [mapBytes, setMapBytes] = useState<number>();
  useEffect(() => {
    if (!state.mapFile) return;
    const controller = new AbortController();
    let closed = false;
    let session: MapRenderSession | undefined;
    void (async () => {
      try {
        const file = await loadMapFile(raceId, state.mapFile!.sha256, offline.storage, controller.signal, () => say({
          tone: "attention", text: offlineSv.olderMap }));
        if (closed) return;
        setMapBytes(file.bytes.byteLength);
        session = new MapRenderSession(createMapWorker, (bounds, _scale, georef) => {
          if (!closed) { setMapBounds(bounds); setGeoreference(georef); setMapStatus("ready"); }
        },
          () => { if (!closed) setMapStatus("failed"); });
        // Kartfilen går över till Workern (ingen kopia stannar här).
        session.load(file.bytes, file.fileName);
        setMapSession(session);
      } catch { if (!closed) setMapStatus("failed"); }
    })();
    return () => { closed = true; controller.abort(); session?.close(); };
  }, [raceId, state.mapFile]);

  const { document, view, selection } = editor;
  const course = document.courses.find(row => row.id === view);
  const radiusMm = 3 * (course?.printScale ?? document.event.mapScale) / document.event.mapScale;
  // ADR-0180 beslut 14: paletten, vridningen, befintliga kontroller, gafflingens grenar, kopia och oanvända kontroller.
  const ux = useCourseSettingUx({ editor, store, apply, edit, readOnly, radiusMm, say, setTab });
  const variant = ux.variant;
  // En delad kontroll flyttad långt i en bana: flytta i alla banor eller ny kontroll bara här (som Purple Pen).
  const moveShared = useMoveShared({ raceId, store, apply, edit, poke: () => sync.poke(), say });
  const cutting = useDetailGaps(mapSession, document);
  // ADR-0180 beslut 13: förslag på kontrollbeskrivning ur kartfilen; objektet markeras när man pekar på ett förslag.
  const suggestions = useDescriptionSuggestions(mapSession, document, view, variant, selection?.kind === "control" ? selection.control : undefined);
  const [suggestionHover, setSuggestionHover] = useState<Parameters<typeof drawSuggestionHighlight>[2]>();
  // ADR-0192: träningsläget (kartans pass, verktygen och fliken Träning).
  const training = useCourseSettingTraining({ document, view, variant, session: mapSession, mapReady: mapStatus === "ready", readOnly, say,
    onEdits: edits => edit(current => applySteps(current, edits, applyEdit)) });
  const options = { course: view, ...(variant ? { variant } : {}), ...cutting.options, training: training.overprint };
  const primitives = useMemo(() => safely("Banpåtrycket", () => layoutOverprint(document, options), () => [] as readonly OverprintPrimitive[]),
    [document, view, variant, cutting.options, training.overprint]);
  const faded = useMemo(() => variant ? safely("Banpåtrycket", () => layoutOverprint(document, { course: view, ...cutting.options, training: training.overprint }),
    () => [] as readonly OverprintPrimitive[]) : [], [document, view, variant, cutting.options, training.overprint]);
  const summaries = useMemo(() => safely("Banornas längder", () => courseSummaries(document), () => []), [document]);
  // Steg 64: symbolerna för beskrivningen på kartan.
  const standard = document.event.descriptionStandard;
  const symbols = useMemo(() => symbolLookup(safely("Symbolerna", () => descriptionSymbols(standard), () => [] as readonly DescriptionSymbol[])), [standard]);
  // ADR-0199: varningarna; vägvalen (en gemensam tabell) avgör sträckorna genom förbjudna områden.
  const routeStore = useRouteResults();
  const forbidden = useForbiddenRoutes({ document, results: routeStore.results, hasMap: Boolean(state.mapFile), tabOpen: tab === "checks" });
  const checks = forbidden.checks, checked = forbidden.checked;
  const [flagged, setFlagged] = useState<CheckRow>();
  // Steg 64: sidan för vald bana (tryckytans ram på kartan i fliken Utskrift).
  const printPage = useMemo(() => {
    if (tab !== "print") return undefined;
    const page = safely("Utskriftslayouten", () => layoutCoursePage(document, { course: view, ...(variant ? { variant } : {}), mapBounds })[0], () => undefined);
    return page ? { page, automatic: printAreaOf(document, view).automatic || !printAreaOf(document, view).rect } : undefined;
  }, [tab, document, view, variant, mapBounds]);
  const selectedSpecial = selection?.kind === "special" ? document.specialObjects.find(item => item.id === selection.special) : undefined;
  const uxDraw = ux.draw, trainingDraw = training.draw;
  const overlayExtra = useMemo(() => (ctx: CanvasRenderingContext2D, mapView: Viewport) => {
    const at = (point: { x: number; y: number }) => toScreen(mapView, point);
    if (printPage) drawPrintFrame(ctx, at, [printPage.page.mapArea], mapView);
    drawSpecialEditing(ctx, at, { drawing: editor.tool === "SPECIAL" ? editor.drawing : undefined, handles: selectedSpecial ? specialHandles(selectedSpecial) : undefined });
    if (suggestionHover) drawSuggestionHighlight(ctx, at, suggestionHover, mapView.pxPerMm);
    uxDraw(ctx, mapView);
    trainingDraw(ctx, mapView);
  }, [printPage, editor.tool, editor.drawing, selectedSpecial, suggestionHover, uxDraw, trainingDraw]);
  const mapHandle = useRef<CourseSettingMapHandle>(null);
  // Oanvända kontroller i Alla kontroller ritas grå och streckade i stället (träffas ändå).
  const drawnPrimitives = useMemo(() => ux.unusedRefs.size > 0 ? primitives.filter(primitive => !ux.unusedRefs.has(primitive.ref ?? "")) : primitives,
    [primitives, ux.unusedRefs]);

  const marks = useMemo(() => {
    const at = (id: string) => document.controls[id]?.at;
    const selected = selection?.kind === "control" && at(selection.control) ? [at(selection.control)!] : [];
    const leg = selection?.kind === "leg" ? document.legs[`${selection.from}-${selection.to}`] : undefined;
    const selectedLine = selection?.kind === "leg" && at(selection.from) && at(selection.to)
      ? [at(selection.from)!, ...(leg?.bends ?? []), at(selection.to)!] : undefined;
    return { selected, selectedLine, bends: leg?.bends ?? [], radiusMm,
      flagged: ux.marks.warnings ? (flagged?.controls ?? []).flatMap(id => at(id) ? [at(id)!] : []) : [] };
  }, [document, selection, flagged, radiusMm, ux.marks.warnings]);

  // Vald sträcka: vägvalen räknas om (bara den sträckan) en kort stund efter senaste ändringen; en ny ändring avbryter.
  const [analysis, setAnalysis] = useState<LegAnalysis>();
  const [legStatus, setLegStatus] = useState<LegStatus>("idle");
  const [highlighted, setHighlighted] = useState<number>();
  const legCourseControls = useMemo(() => view === ALL_CONTROLS ? [] : safely("Banans kontroller",
    () => courseControlOrder(document, view, variant), () => [] as readonly string[]), [document, view, variant]);
  const input = selection?.kind === "leg" && view !== ALL_CONTROLS ? legInput(document, selection.from, selection.to, legCourseControls, view) : undefined;
  const inputKey = input?.key;
  const [lengthWanted, setLengthWanted] = useState(false);
  const routeWorker = useRouteChoiceWorker({ raceId, mapSha256: state.mapFile?.sha256, admin: access.admin, storage: offline.storage,
    wanted: input !== undefined || lengthWanted || forbidden.wanted });
  const routes = routeWorker.session, routeReady = routeWorker.ready;
  // ADR-0190 beslut 6: banans längd längs vägval (samma Worker; en vald sträcka avbryter och sparas i samma tabell).
  const routeLength = useRouteLength({ document, view, variant, session: routes, ready: routeReady, failed: routeWorker.failed,
    wanted: lengthWanted, onWanted: () => setLengthWanted(true), store: routeStore });
  useEffect(() => {
    setAnalysis(undefined); setHighlighted(undefined);
    if (!input) { setLegStatus("idle"); return; }
    if (routeWorker.failed) { setLegStatus("failed"); return; }
    if (!routeReady || !routes.current) { setLegStatus("waiting"); return; }
    setLegStatus("analysing");
    const worker = routes.current;
    const timer = setTimeout(() => {
      routeLength.interrupted();
      worker.analyse([input], (_index, result) => { setAnalysis(result); routeLength.remember(result.key, result.best?.meters, result.straightMeters); },
        () => setLegStatus("done"), () => setLegStatus("failed"));
    }, 250);
    return () => { clearTimeout(timer); worker.cancel(); };
    // Nyckeln ändras med ändarnas lägen; övriga kontroller räknas med när sträckan räknas.
  }, [inputKey, routeReady, routeWorker.failed]);
  const forbiddenRun = useForbiddenRouteRunner({ legs: forbidden.missing, wanted: forbidden.wanted, session: routes, ready: routeReady,
    failed: routeWorker.failed, busy: legStatus === "analysing" || routeLength.running, record: routeStore.record });
  const code = (id: string, end: "S" | "F") => document.controls[id]?.kind === "NORMAL" ? `${document.controls[id].code ?? "?"}.1` : end;
  const legKey = selection?.kind === "leg" && view !== ALL_CONTROLS ? `${code(selection.from, "S")}-${code(selection.to, "F")}` : undefined;
  const routeRows = analysis?.best ? [analysis.best, ...analysis.alternatives] : [];
  const highlightRoute = highlighted !== undefined ? routeRows[highlighted]?.points : undefined;

  // Notiser (ADR-0181 beslut 1 och 8): markeringar och ritningar, filter, ny notis, ritläget och borttagning (`useCourseSettingNotes`).
  const controlsInView = useMemo(() => new Set(view === ALL_CONTROLS ? Object.keys(document.controls)
    : legCourseControls.map(id => document.courseControls[id]?.control).filter((id): id is string => id !== undefined)), [document, view, legCourseControls]);
  const notes = useCourseSettingNotes({ raceId, document, view, allControls: ALL_CONTROLS, controlsInView, serverNotes: collaboration.notes,
    reloadNotes: collaboration.reloadNotes, offline, saved: id => Boolean(sync.document.controls[id]), access, say, map: mapHandle,
    readOnlyCourse: readOnly });
  const { selectedNote, setSelectedNote, setNoteDraft, mapNotes } = notes;
  const me = { accountId: access.accountId, displayName: access.displayName };

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
  const preview = useMemo(() => reviewed ? safely("Förslaget", () => previewSuggestion(document, reviewed, skip), () => undefined) : undefined,
    [reviewed, document, skip]);
  const suggestionDrawing = useMemo(() => {
    if (!preview) return undefined;
    const overlay = suggestionOverlay(document, preview.document);
    return { ...overlay, primitives: safely("Förslagets banpåtryck", () => layoutOverprint(preview.document, options), () => [] as readonly OverprintPrimitive[]),
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
    onTap(point, tolerance, modifiers) {
      const current = store.state;
      setFlagged(undefined);
      if (training.tap(point, tolerance)) return;
      if (!readOnly && ux.tap(point, modifiers)) return;
      const target = hit(point, tolerance);
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
    onDragStart(point, tolerance, pointerType, pxPerMm) {
      const current = store.state;
      if (current.tool !== "SELECT" || readOnly) return false;
      if (ux.startRotate(point, pxPerMm, pointerType)) { drag.current = { kind: "rotate" }; return true; }
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
        drag.current = { kind: "control", control: target.control, dx: at.x - point.x, dy: at.y - point.y, courseControl: target.courseControl };
      }
      store.update(next => beginDrag(select(next, target)));
      return true;
    },
    onDragMove(point, modifiers) {
      const current = drag.current;
      if (!current) return;
      if (current.kind === "rotate") ux.moveRotate(point, modifiers);
      else if (current.kind === "control") store.update(next => dragTo(next, { type: "MOVE_CONTROL", control: current.control,
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
    onDragEnd() {
      const ended = drag.current;
      drag.current = undefined; ux.endRotate();
      if (ended?.kind === "control" && moveShared.dragEnded(ended.courseControl, variant)) return;
      apply(endDrag); sync.poke();
    },
    onHover: (point, modifiers) => ux.hoverAt(point, modifiers),
    onSecondPointer: () => drag.current?.kind === "rotate"
  };
  const cursorAt = (point: { x: number; y: number }, tolerance: number) => {
    if (store.state.tool !== "SELECT") return undefined;
    const target = hit(point, tolerance);
    return target ? (readOnly ? "pointer" : target.kind === "leg" ? "pointer" : "move") : "grab";
  };
  // ADR-0180 beslut 14: "Gaffla här" frågar efter antal grenar eller slinga.
  const fork = ux.openForkPicker;

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
        if (KEYS[key] === "SPECIAL") ux.setPalette(open => !open);
        else apply(next => setTool(next, KEYS[key]!));
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
      let carried: CourseSettingDocument = { ...file.document, event: { ...file.document.event,
        ...(event.printProfiles ? { printProfiles: event.printProfiles } : {}), ...(event.printProfileId ? { printProfileId: event.printProfileId } : {}),
        ...(event.layoutTemplates ? { layoutTemplates: event.layoutTemplates } : {}),
        // Ringklippen står inte heller i .ppen-filen (ADR-0180 beslut 10), inte heller de godtagna varningarna (ADR-0199).
        ...(event.circleCutting ? { circleCutting: event.circleCutting } : {}),
        ...((accepted => accepted ? { acceptedChecks: accepted } : {})(keepAcceptedChecks(event.acceptedChecks, file.document))) },
        // ADR-0192 beslut 10: en fil som sparats i Purple Pen saknar träningen; den nuvarande följer då med.
        ...(!file.document.training && document.training ? { training: document.training } : {}) };
      // ADR-0198: bortvalda varianter följer med när filen saknar dem och varianterna finns kvar.
      carried = carryExcludedVariants(document, carried);
      // ADR-0197: papperet och dess mallar följer med; O-Tid:s egna text- och bildobjekt och beskrivningar på automatisk plats
      // i filen står inte två gånger (`keepPaperOnImport`).
      const imported = keepPaperOnImport(document, carried, await importedImageHashes(carried),
        (doc, course) => layoutCoursePage(doc, { course, mapBounds })[0]);
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
      const next = applySteps(current, [{ type: "ADD_COURSE", name, kind: newCourseKind(state.raceType) }], applyEdit);
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
    ? safely("Textbeskrivningen", () => describeControl(document, selectedControl, descriptionSettings.language), () => "") : "",
  [document, selectedControl, descriptionSettings.language]);

  const suggesting = editor.suggesting !== undefined;
  const statusText = suggesting ? copy.suggestions.draftCount(editor.log.length) : STATUS_TEXT[status];
  // Steg 67: utan nät (eller utloggad) säger statusen hur mycket som väntar i telefonen.
  const shownStatus = suggesting ? statusText : offline.statusText ?? statusText;
  const label = text.map(course?.name ?? text.courses.all);
  // Översynen 2026-11-02: det som inte gick att räkna fram sägs ovanpå kartan (inget sväljs tyst).
  const problems = failedNames([primitives, faded, summaries, checked, legCourseControls, suggestionDrawing?.primitives],
    [cutting.failed && text.problems.circleGaps, suggestions.failed && text.problems.suggestions]);
  const others = collaboration.presence.filter(person => person.accountId !== access.accountId).map(person => person.displayName ?? copy.someone);
  const openSuggestions = collaboration.suggestions.filter(row => row.status === "OPEN").length;
  const openNotes = notes.openCount;
  const tools = readOnly ? (["SELECT", "NOTE"] as const) : EDIT_TOOLS;
  const draft = suggesting ? <SuggestionDraft count={editor.log.length} onSend={sendSuggestion}
    onDiscard={() => store.update(next => endSuggestion(next, true))} /> : undefined;

  // Fältläget (grenen faltlage-snabb, steg 67 bygger vidare): position, Flytta hit, pilar och Uppgifter; på smal skärm i
  // raden nertill i stället för rutan med vald kontroll.
  // Banväljaren finns i fältets rad på telefonen (raden överst har den på bredare skärm).
  const variantsByCourse = useMemo(() => Object.fromEntries(summaries.map(row => [row.course, row.variants.map(item => item.code)])), [summaries]);
  const field = useFieldMode({ raceId, state: editor, apply: edit, georeference, mapBounds, status, statusText: shownStatus, offline: offline.offline,
    readOnly, onView: (next, code) => apply(current => setView(current, next, code)), variants: variantsByCourse, variant,
    inspection: selectedControl ? inspections.get(selectedControl) : undefined, saved: id => Boolean(sync.document.controls[id]),
    onInspect: (control, checked, position) => void offline.enqueueInspection({ formatVersion: 1, control, checked, at: new Date().toISOString(),
      position }).catch(error => console.error("Bocken sparades inte i telefonen", error)),
    onNote: ({ target, at, text: value, photo }) => notes.queueNote(target, at, value, photo), onSketch: () => notes.startSketch("MAP_ERROR"),
    onList: () => { setTab("inspections"); setReveal(value => value + 1); },
    onOffline: () => setOfflineDialog(true),
    onMoveHere: (control, at, done) => moveShared.moveTo(control, at,
      selection?.kind === "control" && selection.control === control ? selection.courseControl : undefined, variant, done),
    suggestion: readOnly ? undefined : <FieldSuggestionLine document={document} control={selectedControl} state={suggestions} symbols={symbols}
      onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} /> });
  const panel = (() => {
    switch (tab) {
      case "courses": return <><RaceTypeHint raceType={state.raceType} /><CourseList document={document} summaries={summaries} view={view} readOnly={readOnly}
        onView={(next, value) => apply(current => setView(current, next, value))} onAdd={addCourse}
        onRename={(id, name) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { name } }], applyEdit))}
        onClasses={(id, classes) => edit(current => applySteps(current, [{ type: "UPDATE_COURSE", course: id, changes: { secondaryTitle: classes } }], applyEdit))}
        onRemove={ux.requestDelete} onDuplicate={ux.duplicate}
        onMove={(id, position) => edit(current => { const step = moveCourseEdit(current.document, id, position);
          return step ? applySteps(current, [step], applyEdit) : current; })} />
        {course && <CourseProperties course={course} summary={summaries.find(row => row.course === course.id)} readOnly={readOnly}
          onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
        {course && <VariantsPanel document={document} course={course} routeLength={routeLength} hasMap={Boolean(state.mapFile)} readOnly={readOnly}
          onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
        {course && <RouteLengthPanel state={routeLength} hasMap={Boolean(state.mapFile)} />}
        <ControlList document={document} summaries={summaries} view={view} variant={variant} branch={ux.active?.start} readOnly={readOnly}
          selected={selection?.kind === "control" ? (view === ALL_CONTROLS ? selection.control : selection.courseControl) : undefined} unused={ux.unused}
          onSelect={target => { apply(current => select(current, { kind: "control", ...target })); const at = document.controls[target.control]?.at;
            if (at) mapHandle.current?.reveal([at]); }}
          onBranch={ux.workIn} onVariant={code => apply(current => setView(current, view, code))} onRemoveUnused={ux.requestRemoveUnused}
          onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />
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
        onPrint={() => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/descriptions`))}
        suggestions={suggestions} readOnly={readOnly} onHoverSuggestion={setSuggestionHover} />;
      case "selected": return <>
        <SelectedPanel state={editor} described={describedControl} readOnly={readOnly}
          onCode={(control, value) => edit(current => applySteps(current, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
          onRemoveFromCourse={() => edit(current => removeSelected(current, applyEdit, false))}
          onDelete={() => edit(current => removeSelected(current, applyEdit, true))}
          onSplit={(kind, branches) => edit(current => addSplit(current, kind, branches, applyEdit))}
          onRemoveSplit={() => edit(current => removeSplit(current, applyEdit))}
          onResetNumber={() => edit(current => current.selection?.kind === "control" && current.selection.courseControl
            ? applySteps(current, [{ type: "MOVE_NUMBER", course: current.view, courseControl: current.selection.courseControl, at: null }], applyEdit) : current)}
          onStraighten={() => edit(current => removeSelected(current, applyEdit))} extra={ux.rotateControls(ux.rotatable)} />
        <LegPanel legKey={legKey} analysis={analysis} status={legStatus} highlighted={highlighted} onHighlight={setHighlighted}
          notice={selection?.kind === "leg" && legStatus === "done" ? legForbiddenNotice(document, view, selection.from, selection.to, analysis) : undefined} />
      </>;
      case "training": return training.panel;
      case "objects": return <SpecialsPanel document={document} state={editor} readOnly={readOnly}
        onKind={kind => apply(current => setTool(current, "SPECIAL", kind))} onFinish={() => edit(current => finishDrawing(current, applyEdit))}
        onCancel={() => apply(current => ({ ...current, drawing: undefined }))}
        onSelect={id => { apply(current => select(current, { kind: "special", special: id })); const found = document.specialObjects.find(item => item.id === id);
          if (found) mapHandle.current?.reveal(found.points); }}
        onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} onAlong={ux.along} />;
      case "print": return <PrintPanel document={document} view={view} page={printPage?.page} readOnly={readOnly}
        onEdits={edits => edit(current => applySteps(current, edits, applyEdit))}
        onPreview={() => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/print?course=${encodeURIComponent(view)}`))} />;
      case "checks": return <ChecksPanel groups={checks.groups} accepted={checks.accepted} readOnly={readOnly}
        routes={{ pending: forbidden.missing.length, running: forbiddenRun.running, failed: forbiddenRun.failed }}
        onAccept={rows => edit(current => applySteps(current, [(_created, doc) => acceptChecksEdit(doc, rows.flatMap(row => row.checks))], applyEdit))}
        onUnaccept={rows => edit(current => applySteps(current, [() => unacceptChecksEdit(rows.map(row => row.key))], applyEdit))}
        onShow={row => { setFlagged(row); apply(current => showCheckRow(current, row));
          mapHandle.current?.reveal(row.controls.flatMap(id => document.controls[id] ? [document.controls[id].at] : [])); }} />;
      case "notes": return notes.panel;
      case "inspections": return <InspectionsPanel rows={inspectionList} selected={selection?.kind === "control" ? selection.control : undefined}
        offline={offline.offline} action={field.inspect}
        onSelect={control => {
          apply(current => select(current, { kind: "control", control }));
          const at = document.controls[control]?.at;
          if (at) mapHandle.current?.focus(at);
        }} />;
      case "suggestions": return <SuggestionsPanel suggestions={collaboration.suggestions} document={document} reviewing={reviewing}
        onReview={id => { setReviewing(id); setSkip(new Set()); setDecision(undefined); }} skip={skip} onSkip={setSkip}
        canDecide={access.level === "EDIT"} onDecide={decide} result={decision} rejected={rejectedInPreview} draft={draft} />;
      // Inställningar: banans utseende (ADR-0180 beslut 12), arbetssättet, utan nät och ringklippen (beslut 10).
      case "settings": return <>
      <AppearancePanel document={document} view={view} readOnly={readOnly} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />
      <section className={styles.panel} aria-labelledby="course-setting-mode">
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
      {!readOnly && moveShared.settings(document.event.mapScale)}
      {!readOnly && <CircleCuttingPanel document={document} cutting={cutting} onEdits={edits => edit(current => applySteps(current, edits, applyEdit))} />}
      </>;
    }
  })();

  useLockedPage();
  // ADR-0180 beslut 14: Objekt öppnar paletten (också i telefonens kompakta läge, bakom "Mer").
  const toolBar = <ToolBar tool={ux.palette ? "SPECIAL" : editor.tool} tools={tools} inCourse={view !== ALL_CONTROLS} onTool={tool => {
    if (tool === "SPECIAL") ux.setPalette(open => !open);
    else { ux.setPalette(false); apply(current => setTool(current, tool)); }
  }}
    onFork={readOnly ? undefined : fork} help={text.tools.help[editor.tool] ?? ""} onTraining={() => { setTab("training"); setReveal(value => value + 1); }} trainingOpen={tab === "training"} />;

  const menu = [{ label: copy.topbar.fileMenu, onClick: () => setDialog("file") },
    ...(access.admin && canTransfer(state.raceType) ? [{ label: copy.topbar.transfer, onClick: () => setDialog("transfer") }] : []),
    { label: copy.topbar.settings, onClick: () => setTab("settings") },
    // Utskriftens sidor direkt från Fil (ägaren 2026-11-03), efter att det osparade skickats.
    { label: text.printMenu, onClick: () => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/print${view !== ALL_CONTROLS ? `?course=${encodeURIComponent(view)}` : ""}`)) },
    { label: text.descriptionsMenu, onClick: () => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/descriptions`)) },
    { label: `${offlineSv.panel.heading} …`, onClick: () => setOfflineDialog(true) }];
  // `course-setting-shell` (globals.css): sidan under arbetsytan skrollar och studsar aldrig.
  return <main className={`${styles.shell} course-setting-shell`} data-version={version} data-level={access.level}
    data-field={field.narrow ? "" : undefined}>
    <TopBar raceId={raceId} document={document} summaries={summaries} view={view} variant={variant}
      onView={(next, value) => apply(current => setView(current, next, value))}
      status={<p role="status" aria-live="polite" className={styles.status} data-status={suggesting ? "pending" : offline.offline || offline.storageError ? "failed" : status}
        data-testid="course-setting-status">{shownStatus}</p>}
      access={access.level === "EDIT" ? "" : copy.access[access.level]} presence={copy.presence(others)}
      canUndo={canUndo(editor) && !readOnly} canRedo={canRedo(editor) && !readOnly} onUndo={() => edit(undo)} onRedo={() => edit(redo)} menu={menu}
      admin={access.admin} help={courseSettingHelpViews(tab, field.narrow || field.position !== undefined)} />
    {/* Telefonen: verktygen och flikarna (även Objekt och Utskrift) bakom "Mer"; medan ett specialobjekt ritas syns
        verktygsraden och fliken Objekt (Klar och Avbryt). */}
    <div className={styles.stage} data-compact={field.narrow && !field.expanded && editor.tool !== "SPECIAL" ? "true" : undefined}>
      <div className={styles.mapArea}>
        <CourseSettingMap session={mapSession} mapBounds={mapBounds} primitives={drawnPrimitives} faded={faded} ghosts={ux.ghosts} others={ux.others}
          marks={marks} analysis={analysis}
          label={label} cursor={notes.sketching || training.drawing ? "crosshair" : CURSOR[editor.tool]} mapPasses={training.passes} handlers={notes.sketching ? notes.handlers : handlers}
          handle={mapHandle} noteMarks={ux.marks.notes ? mapNotes : undefined} selectedNote={selectedNote} sketches={notes.sketchLayer}
          onNoteTap={id => { setSelectedNote(id); setTab("notes"); }} suggestion={suggestionDrawing} cursorAt={notes.sketching ? undefined : cursorAt}
          highlightRoute={highlightRoute}
          position={field.position} inspected={ux.marks.inspected ? inspectedMarks : undefined} onPan={field.onPan} symbols={symbols} overlayExtra={overlayExtra} cross={selection?.kind === "control" && document.controls[selection.control]
            ? { at: document.controls[selection.control]!.at, dragging: editor.dragBase !== undefined } : undefined} />
        {field.narrow ? <div className={styles.bottomStack} data-map-overlay="">
          {toolBar}
          {notes.card && <div className={styles.cardStatic}>{notes.card}</div>}
          {!notes.sketching && <div className={styles.fieldBar} data-testid="course-setting-field">{field.bar}</div>}
        </div> : <>{toolBar}<div className={styles.fieldTools}>{field.tools}</div></>}
        {ux.elements}
        <div className={styles.toasts}>
          {ux.toasts}
          {mapStatus === "reading" && <p role="status" className={styles.toast}>{text.readingMap}</p>}
          {mapStatus === "failed" && <Notice tone="attention">{text.mapFailed}</Notice>}
          {suggesting && <p className={styles.toast} data-testid="course-setting-suggesting">{copy.suggestions.drafting}: {copy.suggestions.draftCount(editor.log.length)}
            {" "}<Button variant="quiet" onClick={() => setTab("suggestions")}>{copy.suggestions.send} …</Button></p>}
          {reviewed && <p className={styles.toast}>{copy.suggestions.reviewing}</p>}
          {editor.error && !field.narrow && <p role="alert" className={styles.toast}>{editor.error}</p>}
          {problems.length > 0 && <div data-testid="course-setting-problems"><Notice tone="error" role="alert">{text.problems.failed(problems)}</Notice></div>}
          {messages.map(message => <div key={message.id} className={styles.toastBox}>
            <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
              <p>{message.text}</p>
              {message.list && message.list.length > 0 && <ul>{message.list.map(row => <li key={row}>{row}</li>)}</ul>}
            </Notice>
            <Button variant="quiet" aria-label={copy.topbar.close} onClick={() => dismiss(message.id)}>×</Button>
          </div>)}
        </div>
        {field.narrow ? null : notes.card ? <div className={styles.card}>{notes.card}</div>
          // Rutan med vald kontroll bara med Välj: när man sätter ut kontroller eller notiser ligger den inte i vägen.
          : editor.tool === "SELECT" && <SelectionCard state={editor} described={describedControl} readOnly={readOnly}
            onCode={(control, value) => edit(current => applySteps(current, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
            onRemoveFromCourse={() => edit(current => removeSelected(current, applyEdit, false))}
            onDelete={() => edit(current => removeSelected(current, applyEdit, true))}
            onDescription={() => setTab("description")} onMore={() => setTab("selected")} onClose={() => apply(current => select(current, undefined))}
            extra={ux.rotateControls(ux.rotatable?.kind === "control" ? ux.rotatable : undefined)} />}
      </div>
      <Drawer tab={tab} onTab={setTab} reveal={reveal} counts={{ checks: checks.count, notes: openNotes,
        suggestions: openSuggestions + (suggesting ? editor.log.length : 0) }}>
        {panel}
      </Drawer>
    </div>
    {dialog === "file" && <Dialog title={text.file.heading} onClose={() => setDialog(undefined)}>
      <FilePanel raceId={raceId} document={document} original={state.original} busy={busy || access.level !== "EDIT"} onImport={onImport}
        onRestore={onRestore} mapBounds={mapBounds} georeference={georeference} />
    </Dialog>}
    {dialog === "transfer" && access.admin && <Dialog title={text.transfer.heading} onClose={() => setDialog(undefined)}>
      <TransferPanel raceId={raceId} ready={!busy} flush={flush} version={() => sync.version} />
    </Dialog>}
    {moveShared.dialog}
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
