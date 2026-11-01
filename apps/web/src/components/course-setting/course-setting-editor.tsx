"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CourseSettingConflict, CourseSettingState } from "@o-tid/contracts";
import {
  applyEdit, checkDocument, courseControlOrder, courseSummaries, describeControl, layoutOverprint, nextFreeCode, type CourseSettingDocument, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import type { LegAnalysis, RouteChoiceSettings } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { Autosaver, type AutosaveStatus } from "../../lib/course-setting-autosave";
import {
  browserStorage, descriptionLanguageOf, readDescriptionSettings, writeDescriptionSettings, type DescriptionSettings
} from "../../lib/course-setting-description";
import { fetchCourseSettingRevision, importCourseSetting, restoreCourseSetting, saveCourseSetting } from "../../lib/course-setting-api";
import {
  addBend, addPoint, addSplit, applySteps, beginDrag, cancelTool, createEditor, dragTo, endDrag, insertExisting, redo, removeSelected,
  removeSplit, replaceDocument, select, setTool, setView, undo, type EditorState, type Tool
} from "../../lib/course-setting-editor";
import { ALL_CONTROLS, hitTest, nearestBend } from "../../lib/course-setting-hit";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { checkRows, legInput, type CheckRow } from "../../lib/course-setting-text";
import type { Bounds } from "../../lib/course-setting-viewport";
import { fetchMapSource, fetchRouteChoice } from "../../lib/route-choice-api";
import { RouteChoiceSession } from "../../lib/route-choice-client";
import { Button, Notice } from "../ui";
import { FieldShell, useFieldMode } from "./course-setting-field";
import { FilePanel, type ReadFile } from "./course-setting-file";
import { DescriptionPanel } from "./course-setting-description";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "./course-setting-map";
import { ChecksPanel, CourseList, LegPanel, SelectedPanel, ToolPanel } from "./course-setting-panels";
import { TransferPanel } from "./course-setting-transfer";
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

const CURSOR: Record<Tool, string> = { SELECT: "default", ADD_CONTROL: "crosshair", ADD_START: "crosshair", ADD_FINISH: "crosshair",
  ADD_CROSSING: "crosshair", INSERT_EXISTING: "copy", ADD_BEND: "crosshair" };

/**
 * Steg 62 (ADR-0180): editorn. Logiken finns i `lib/course-setting-*` (editorns tillstånd, träff-test, kartvy,
 * autosparande); här kopplas den till kartan, spalten, tangenterna, autosparandet och vägvalens Worker.
 */
export function CourseSettingEditor({ raceId, state, notice, onReload }: {
  raceId: string; state: CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> };
  notice?: string | undefined; onReload: () => void;
}) {
  const [editor, setEditor] = useState<EditorState>(() => createEditor(state.setting.document as unknown as CourseSettingDocument));
  const stateRef = useRef(editor);
  stateRef.current = editor;
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [conflict, setConflict] = useState<CourseSettingConflict>();
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "attention"; text: string; warnings?: readonly string[] } | undefined>(
    notice ? { tone: "ok", text: notice } : undefined);
  const [busy, setBusy] = useState(false);
  const serverRevision = useRef(0);
  const saver = useMemo(() => new Autosaver<CourseSettingDocument, CourseSettingConflict>(state.setting.version, {
    save: (document, expectedVersion) => saveCourseSetting(raceId, document, expectedVersion),
    onStatus: (next, detail) => { setStatus(next); if (next === "conflict") setConflict(detail?.conflict); }
  }), [raceId, state.setting.version]);
  useEffect(() => { saver.attach(); return () => saver.detach(); }, [saver]);

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
        const [file, settings] = await Promise.all([fetchMapSource(raceId, controller.signal),
          fetchRouteChoice(raceId, controller.signal).then(value => value.settings as RouteChoiceSettings, () => ({ version: 1 }) as RouteChoiceSettings)]);
        if (closed) return;
        session = new MapRenderSession(createMapWorker, (bounds, _scale, georef) => { if (!closed) { setMapBounds(bounds); setGeoreference(georef); setMapStatus("ready"); } },
          () => { if (!closed) setMapStatus("failed"); });
        session.load(file.bytes.slice(0), file.fileName);
        setMapSession(session);
        const worker = new RouteChoiceSession(createRouteWorker);
        routes.current = worker;
        worker.load(file.bytes, file.fileName, settings, () => { if (!closed) setRouteReady(true); }, () => { if (!closed) setRouteReady(false); });
      } catch { if (!closed) setMapStatus("failed"); }
    })();
    return () => { closed = true; controller.abort(); session?.close(); routes.current?.close(); routes.current = undefined; };
  }, [raceId, state.mapFile]);

  // Autosparandet: varje ändring (inte under en dragning, inte ett dokument som just kom från servern).
  useEffect(() => {
    if (editor.dragBase || editor.revision === 0 || editor.revision === serverRevision.current) return;
    saver.change(editor.document);
  }, [editor.revision, editor.dragBase, editor.document, saver]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saver.dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saver]);

  const { document, view, variant, selection } = editor;
  const options = { course: view, ...(variant ? { variant } : {}) };
  const primitives = useMemo(() => safely("Banpåtrycket", () => layoutOverprint(document, options), [] as readonly OverprintPrimitive[]),
    [document, view, variant]);
  const faded = useMemo(() => variant ? safely("Banpåtrycket", () => layoutOverprint(document, { course: view }), [] as readonly OverprintPrimitive[]) : [],
    [document, view, variant]);
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
  const legCourseControls = useMemo(() => view === ALL_CONTROLS ? [] : safely("Banans kontroller",
    () => courseControlOrder(document, view, variant), [] as readonly string[]), [document, view, variant]);
  const input = selection?.kind === "leg" && view !== ALL_CONTROLS ? legInput(document, selection.from, selection.to, legCourseControls) : undefined;
  const inputKey = input?.key;
  useEffect(() => {
    setAnalysis(undefined);
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

  const apply = (next: (current: EditorState) => EditorState) => setEditor(current => next(current));
  const drag = useRef<Drag | undefined>(undefined);
  const hit = (point: { x: number; y: number }, tolerance: number) => hitTest(stateRef.current.document, stateRef.current.view, primitives, point, tolerance);
  const handlers: MapPointerHandlers = {
    onTap(point, tolerance) {
      const current = stateRef.current;
      const target = hit(point, tolerance);
      setFlagged(undefined);
      switch (current.tool) {
        case "SELECT": apply(state => select(state, target)); return;
        case "INSERT_EXISTING": if (target && target.kind !== "leg") apply(state => insertExisting(state, target.control, applyEdit)); return;
        case "ADD_BEND":
          if (target?.kind === "leg") apply(state => addBend(select(state, target), point, applyEdit));
          else apply(state => addBend(state, point, applyEdit));
          return;
        default: apply(state => addPoint(state, current.tool, point, applyEdit, nextFreeCode));
      }
    },
    onDragStart(point, tolerance) {
      const current = stateRef.current;
      if (current.tool !== "SELECT") return false;
      const selected = current.selection;
      if (selected?.kind === "leg") {
        const index = nearestBend(current.document.legs[`${selected.from}-${selected.to}`]?.bends ?? [], point, tolerance);
        if (index !== undefined) { drag.current = { kind: "bend", from: selected.from, to: selected.to, index }; apply(beginDrag); return true; }
      }
      const target = hit(point, tolerance);
      if (!target || target.kind === "leg") return false;
      if (target.kind === "number" && target.courseControl && current.view !== ALL_CONTROLS) drag.current = { kind: "number", courseControl: target.courseControl };
      else {
        const at = current.document.controls[target.control]!.at;
        drag.current = { kind: "control", control: target.control, dx: at.x - point.x, dy: at.y - point.y };
      }
      apply(state => beginDrag(select(state, target)));
      return true;
    },
    onDragMove(point) {
      const current = drag.current;
      if (!current) return;
      if (current.kind === "control") apply(state => dragTo(state, { type: "MOVE_CONTROL", control: current.control, at: { x: point.x + current.dx, y: point.y + current.dy } }, applyEdit));
      else if (current.kind === "number") apply(state => dragTo(state, { type: "MOVE_NUMBER", course: state.view, courseControl: current.courseControl, at: point }, applyEdit));
      else apply(state => {
        const bends = [...(state.dragBase?.legs[`${current.from}-${current.to}`]?.bends ?? [])];
        bends[current.index] = point;
        return dragTo(state, { type: "SET_LEG_BENDS", from: current.from, to: current.to, bends }, applyEdit);
      });
    },
    onDragEnd() { drag.current = undefined; apply(endDrag); }
  };

  // Tangenterna (inte när man skriver i ett fält).
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']"))) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); apply(state => removeSelected(state, applyEdit)); }
      else if (event.key === "Escape") apply(cancelTool);
      else if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); apply(event.shiftKey ? redo : undo); }
      else if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); apply(redo); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  /** Ett dokument från servern (inläsning, återställning): historiken börjar om och sparandet bygger på dess version. */
  function fromServer(next: CourseSettingDocument, version: number) {
    setEditor(current => { const replaced = replaceDocument(current, next); serverRevision.current = replaced.revision; return replaced; });
    saver.reset(version);
    setConflict(undefined);
  }

  async function flush(): Promise<boolean> {
    await saver.flush();
    return !saver.dirty && status !== "conflict" && !conflict;
  }

  async function onImport(file: ReadFile) {
    if (!window.confirm(text.file.replaceConfirm)) return;
    setBusy(true); setMessage(undefined);
    try {
      await saver.flush();
      const outcome = await importCourseSetting(raceId, { document: file.document, expectedVersion: saver.currentVersion, fileName: file.fileName, ppen: file.ppen });
      if (outcome.kind === "conflict") { setStatus("conflict"); setConflict(outcome.conflict); saver.stop(); return; }
      if (outcome.kind === "too-large") { setMessage({ tone: "error", text: text.file.tooLarge }); return; }
      fromServer(file.document, outcome.version);
      setMessage({ tone: "ok", text: text.file.imported(file.document.courses.length, Object.keys(file.document.controls).length),
        warnings: file.warnings.map(warning => warning.text) });
    } catch { setMessage({ tone: "error", text: text.file.failed }); } finally { setBusy(false); }
  }

  async function onRestore(version: number): Promise<boolean> {
    setBusy(true);
    try {
      await saver.flush();
      const outcome = await restoreCourseSetting(raceId, saver.currentVersion, version);
      if (outcome.kind !== "saved") { if (outcome.kind === "conflict") { setStatus("conflict"); setConflict(outcome.conflict); saver.stop(); } return false; }
      const revision = await fetchCourseSettingRevision(raceId, version);
      fromServer(revision.document as unknown as CourseSettingDocument, outcome.version);
      return true;
    } catch { return false; } finally { setBusy(false); }
  }

  function addCourse(name: string) {
    apply(current => {
      const next = applySteps(current, [{ type: "ADD_COURSE", name }], applyEdit);
      const created = next.document.courses.find(row => !current.document.courses.some(old => old.id === row.id));
      return created ? setView(next, created.id) : next;
    });
  }

  // Steg 63: beskrivningens språk (i dokumentet) och visningssätt (i webbläsaren per tävling), vald kontrolls beskrivning i text.
  const router = useRouter();
  const [descriptionKind, setDescriptionKind] = useState<DescriptionSettings["kind"]>(() =>
    readDescriptionSettings(browserStorage(), raceId, state.setting.document as unknown as CourseSettingDocument).kind);
  const descriptionSettings = useMemo<DescriptionSettings>(() => ({ language: descriptionLanguageOf(document), kind: descriptionKind }),
    [document, descriptionKind]);
  const selectedControl = selection?.kind === "control" ? selection.control : undefined;
  const describedControl = useMemo(() => selectedControl
    ? safely("Textbeskrivningen", () => describeControl(document, selectedControl, descriptionSettings.language), "") : "",
  [document, selectedControl, descriptionSettings.language]);

  const statusText = status === "conflict" ? text.status.conflict : status === "too-large" ? text.status.tooLarge : text.status[status];
  const conflictTime = conflict?.current ? new Date(conflict.current.updatedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : "";
  const label = text.map(course?.name ?? text.courses.all);
  const field = useFieldMode({ raceId, state: editor, apply, georeference, mapBounds, status, statusText, version: () => saver.currentVersion });
  return <>
    <div className={styles.head}>
      <p role="status" aria-live="polite" className={styles.status} data-status={status} data-testid="course-setting-status">{statusText}</p>
    </div>
    {(status === "conflict") && <Notice tone="error" role="alert"><p>{text.status.conflictHelp(conflict?.current?.updatedBy.displayName ?? null, conflictTime)}</p>
      <div><Button variant="secondary" onClick={onReload}>{text.status.reload}</Button></div></Notice>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
      <p>{message.text}</p>
      {message.warnings && message.warnings.length > 0 && <><p>{text.file.warnings}</p><ul>{message.warnings.map(row => <li key={row}>{row}</li>)}</ul></>}
    </Notice>}
    {field.notice}
    {mapStatus === "reading" && <p role="status" className={styles.muted}>{text.readingMap}</p>}
    {mapStatus === "failed" && <Notice tone="attention">{text.mapFailed}</Notice>}
    <FieldShell narrow={field.narrow} bar={field.bar}><div className={styles.workspace}>
      <CourseSettingMap session={mapSession} mapBounds={mapBounds} primitives={primitives} faded={faded} marks={marks} analysis={analysis}
        label={label} cursor={CURSOR[editor.tool]} handlers={handlers} handle={mapHandle} position={field.position} tools={field.narrow ? undefined : field.tools} />
      <div className={styles.side} style={field.narrow ? { display: "none" } : undefined}>
        <CourseList document={document} summaries={summaries} view={view} variant={variant} onView={(next, code) => apply(state => setView(state, next, code))}
          onAdd={addCourse}
          onRename={(id, name) => apply(state => applySteps(state, [{ type: "UPDATE_COURSE", course: id, changes: { name } }], applyEdit))}
          onClasses={(id, classes) => apply(state => applySteps(state, [{ type: "UPDATE_COURSE", course: id, changes: { secondaryTitle: classes } }], applyEdit))}
          onRemove={id => apply(state => setView(applySteps(state, [{ type: "DELETE_COURSE", course: id }], applyEdit), ALL_CONTROLS))} />
        <DescriptionPanel document={document} view={view} variant={variant} selection={selection} settings={descriptionSettings}
          onSettings={next => {
            setDescriptionKind(next.kind);
            writeDescriptionSettings(browserStorage(), raceId, next);
            if (next.language !== descriptionSettings.language) {
              apply(current => applySteps(current, [{ type: "SET_EVENT", changes: { descriptionLanguage: next.language } }], applyEdit));
            }
          }}
          onSelect={target => apply(state => select(state, target))}
          onEdit={edits => apply(state => applySteps(state, edits, applyEdit))}
          onPrint={() => void flush().finally(() => router.push(`/admin/${raceId}/course-setting/descriptions`))} />
        <ToolPanel state={editor} onTool={tool => apply(state => setTool(state, tool))} onUndo={() => apply(undo)} onRedo={() => apply(redo)} />
        <SelectedPanel state={editor} described={describedControl}
          onCode={(control, value) => apply(state => applySteps(state, [{ type: "SET_CONTROL_CODE", control, code: value }], applyEdit))}
          onRemoveFromCourse={() => apply(state => removeSelected(state, applyEdit, false))}
          onDelete={() => apply(state => removeSelected(state, applyEdit, true))}
          onSplit={(kind, branches) => apply(state => addSplit(state, kind, branches, applyEdit))}
          onRemoveSplit={() => apply(state => removeSplit(state, applyEdit))}
          onResetNumber={() => apply(state => state.selection?.kind === "control" && state.selection.courseControl
            ? applySteps(state, [{ type: "MOVE_NUMBER", course: state.view, courseControl: state.selection.courseControl, at: null }], applyEdit) : state)}
          onStraighten={() => apply(state => removeSelected(state, applyEdit))} />
        <LegPanel legKey={legKey} analysis={analysis} status={legStatus} />
        <ChecksPanel rows={checks} onShow={row => {
          setFlagged(row);
          if (row.course && document.courses.some(item => item.id === row.course)) apply(state => setView(state, row.course!));
          if (row.controls.length === 1) apply(state => select(state, { kind: "control", control: row.controls[0]! }));
          mapHandle.current?.reveal(row.controls.flatMap(id => document.controls[id] ? [document.controls[id].at] : []));
        }} />
        <FilePanel raceId={raceId} document={document} original={state.original} busy={busy} onImport={onImport} onRestore={onRestore} />
        <TransferPanel raceId={raceId} ready={status !== "conflict" && !busy} flush={flush} version={() => saver.currentVersion} />
      </div>
    </div></FieldShell>
  </>;
}
