"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapProjectNotesEn } from "../../i18n/map-project-tools-en";
import { mapProjectReconEn } from "../../i18n/map-project-more-en";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { mapProjectLayersEn } from "../../i18n/map-project-en";
import { mapProjectWorkLayersEn } from "../../i18n/map-project-more-en";
import { mapProjectRectifyEn } from "../../i18n/map-project-more-en";
import { useTexts, useLocale } from "../language-provider";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapObject, Point } from "@o-tid/map-file";
import {
  MAX_SEGMENT_M, bendSegment, deleteVertex, hitDistance, moveHandle, moveVertex, nearestSegment, newKey, vertexHandles, withSymbol,
  type EditKind, type ObjectKey, type ObjectRef, type VertexAddress
} from "@o-tid/map-revision";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { Viewport } from "../../lib/course-setting-viewport";
import { draftObject, nearestVertex, rotatePoint, translateObject, type DraftPoint } from "../../lib/map-project-draw";
import {
  drawAreas, drawControlPoints, drawDraftPoints, drawHandles, drawMapArea, drawMarquee, drawMultiSelection, drawPreview, drawProposed, drawSelection, STAGE_COLORS, stageAge, type AreaDrawing
} from "../../lib/map-project-overlay";
import { coverageImage, drawCoverage, drawNormIssues, drawNotes, drawReconMarkers, drawTracks, noteAt } from "../../lib/map-project-recon-overlay";
import { MapProjectNormPanel } from "./map-project-norm-panel";
import { MapProjectGeneralizePanel } from "./map-project-generalize-panel";
import { useMapProjectGeneralize } from "./use-map-project-generalize";
import { useMapProjectRectify } from "./use-map-project-rectify";
import { MapProjectRectifyPanel } from "./map-project-rectify-panel";
import { MapProjectNorthPanel } from "./map-project-north-panel";
import { mapProjectRectifySv } from "../../i18n/map-project-rectify-sv";
import { useMapProjectNorm } from "./use-map-project-norm";
import { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import { NoteDetail, NoteForm, NotesPanel } from "./map-project-notes";
import { useMapProjectNotes } from "./use-map-project-notes";
import { metersPerMm, toMapPosition } from "../../lib/course-setting-geo";
import { mapProjectReconSv } from "../../i18n/map-project-recon-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { MapProjectSymbolLayers } from "./map-project-symbol-layers";
import { useMapProjectSymbolLayers } from "./use-map-project-symbol-layers";
import { useMapProjectWorkLayers } from "./use-map-project-work-layers";
import { MapProjectWorkLayers } from "./map-project-work-layers";
import { drawSketches } from "../../lib/map-project-sketch";
import { mapProjectWorkLayersSv } from "../../i18n/map-project-work-layers-sv";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "../course-setting/course-setting-map";
import { AccountMenu } from "../account-menu";
import { Button, Notice } from "../ui";
import { MapProjectCollabPanel } from "./map-project-collab-panel";
import { MapProjectFieldControls, type PositionMode } from "./map-project-field-controls";
import { MapProjectReconPanel } from "./map-project-recon-panel";
import { useMapProjectLayers } from "./use-map-project-layers";
import { useMapProjectControlPoints } from "./use-map-project-control-points";
import { mapProjectLayersSv } from "../../i18n/map-project-layers-sv";
import { useMapProjectImport } from "./use-map-project-import";
import { drawLayers } from "../../lib/map-project-layers";
import { useMapProjectPosition, type TimedFix } from "./use-map-project-position";
import { useMapProjectRecon } from "./use-map-project-recon";
import { saveMapProjectShell } from "../../lib/map-project-offline";
import { MapProjectSidebar, type SidebarTab } from "./map-project-sidebar";
import { noticeText, SyncBadge } from "./map-project-sync-badge";
import { MapProjectUnderlayPanels } from "./map-project-underlay-panels";
import { reverseLine } from "../../lib/map-project-join";
import { clickTool } from "./map-project-click-tools";
import { MapProjectColors } from "./map-project-colors";
import { railTools, wheelToolsOf } from "./map-project-rail-tools";
import { MapProjectToolRail } from "./map-project-tool-rail";
import { HelpButton } from "../help/help-panel";
import { MapProjectKeysDialog, useMapProjectKeys } from "./map-project-keys-dialog";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { mapProjectKeysEn } from "../../i18n/map-project-tools-en";
import { keyLabel } from "../../lib/map-project-keys";
import { editPointAt } from "../../lib/map-project-point-edit";
import { anchorOf, ROTATE_CURSOR, useMapProjectMulti } from "./use-map-project-multi";
import { useMapProjectShortcuts, type SelectedCommand } from "./use-map-project-shortcuts";
import { useMapProjectCollaboration } from "./use-map-project-collaboration";
import { useMapProjectEditor } from "./use-map-project-editor";
import { MapProjectToolWheel, type WheelAction } from "./map-project-tool-wheel";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { circleFor, shapeActions, withRecent } from "../../lib/map-project-shape-actions";
import styles from "./map-project-editor.module.css";

/** `area` = rita ett delområde (bara ägarna); `note` = tryck där en notis ska sitta (K3); `circle` = runda former (ägaren 2026-11-09). */
type Tool = "select" | "draw" | "area" | "note" | "circle" | "addPoint" | "removePoint" | "cut";
interface Selected { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }
type Drag =
  | { readonly mode: "vertex"; readonly address: VertexAddress; readonly original: MapObject }
  | { readonly mode: "object"; readonly start: Point; readonly original: MapObject }
  | { readonly mode: "rotate"; readonly original: MapObject }
  | { readonly mode: "place"; readonly at: Point }
  | { readonly mode: "handle" }
  /** K3: sträckan böjs (dras i där man tog tag). */
  | { readonly mode: "bend"; readonly address: VertexAddress; readonly t: number; readonly start: Point; readonly original: MapObject }
  /** K3: punktens styrpunkt dras. */
  | { readonly mode: "curveHandle"; readonly address: VertexAddress; readonly which: "in" | "out"; readonly original: MapObject }
  /** Cirkeln dras från mitten ut till kanten. */
  | { readonly mode: "circle"; readonly center: Point };

const NO_MARKS = { selected: [], flagged: [], radiusMm: 0 } as const;
const SHOWN_STATUSES = new Set(["UNSEEN", "PASSED", "CHECKED"] as const);
const DOUBLE_TAP_MS = 350;
const recentKey = (projectId: string) => `otid-map-recent:${projectId}`;
const degreesTo = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
/** Förslagens ändringar att rita: nya lägen och platserna för borttagningar (ändringens punkt). */
interface ProposedDrawing { readonly objects: MapObject[]; readonly deleted: Point[] }
function proposedDrawing(edits: readonly { state: unknown; point?: Point | null | undefined }[]): ProposedDrawing {
  const objects: MapObject[] = [], deleted: Point[] = [];
  for (const edit of edits) {
    const value = edit.state as { kind?: string; object?: MapObject } | undefined;
    if (value?.kind === "OBJECT" && value.object) objects.push(value.object);
    else if (value?.kind === "DELETED" && edit.point) deleted.push(edit.point);
  }
  return { objects, deleted };
}

/**
 * ADR-0219 (K1): kartprojektets karta med ritverktygen. Kartan ritas i Workern med alla ändringar; markeringen, objektet som
 * dras och utkastet ritas ovanpå. Verktygen som i Mapper: Redigera (E) markerar och flyttar objekt och punkter, Rita (P)
 * ritar med vald symbol (klick = hörn, tryck och dra = kurva, dubbelklick eller Enter avslutar). Delete tar bort, Ctrl/Cmd+Z
 * ångrar och Ctrl/Cmd+Skift+Z eller Ctrl+Y gör om. Varje ändring blir en ändring av ett objekt i projektets kö.
 */
/** Linjeändar närmare varandra än så (mm på kartan) räknas som att de möts när linjer slås ihop. */
const JOIN_MM = 0.3;

export function MapProjectEditor({ view, offlineSince }: { view: MapProjectView;
  /** K3: projektet kommer från telefonen (utan nät), sparat då. */
  offlineSince?: string | undefined }) {
  const locale = useLocale();
  const notesText = useTexts(mapProjectNotesSv, mapProjectNotesEn);
  const reconText = useTexts(mapProjectReconSv, mapProjectReconEn);
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const quick = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const layersText = useTexts(mapProjectLayersSv, mapProjectLayersEn);
  const workText = useTexts(mapProjectWorkLayersSv, mapProjectWorkLayersEn);
  const rectifyText = useTexts(mapProjectRectifySv, mapProjectRectifyEn);
  const collab = useMapProjectCollaboration(view);
  const { loadProposals } = collab;
  // Efter en synk med egna ändringar eller andras: förslagen kan ha ändrats.
  const editor = useMapProjectEditor(view, useCallback(() => { void loadProposals(); }, [loadProposals]));
  const { session, catalog, commit, setPreview } = editor;
  // K3: rekningen och fältet.
  const recon = useMapProjectRecon({ view, session, georeference: editor.georeference, clientState: editor.state, renderKey: editor.renderKey });
  const [positionMode, setPositionMode] = useState<PositionMode>("off");
  /** Linjen som gås med GPS (punkterna i kartans mm), eller undefined. */
  const [walk, setWalk] = useState<readonly Point[]>();
  const walkRef = useRef<readonly Point[] | undefined>(undefined);
  const georeference = editor.georeference;
  // K4a: egna underlag (ritas först, under allt annat ovanpå kartan).
  const layers = useMapProjectLayers(view, georeference ?? undefined);
  const control = useMapProjectControlPoints(layers);
  const drawnLayers = control.drawn;
  // Normkontrollen (av från början).
  const norm = useMapProjectNorm(session, editor.renderKey);
  const [shownIssue, setShownIssue] = useState<Point>();
  const normIssues = norm.result?.issues;
  const recordFix = recon.onFix;
  const onFix = useCallback((fix: TimedFix) => {
    recordFix(fix);
    const current = walkRef.current;
    if (!current || !georeference) return;
    let at: Point;
    try { at = toMapPosition(georeference, fix).at; } catch { return; }
    const last = current[current.length - 1];
    // En ny punkt var 2 m (bättre noggrannhet än så har inte telefonen i skog).
    if (last && Math.hypot(at.x - last.x, at.y - last.y) * metersPerMm(georeference, georeference.scale) < 2) return;
    walkRef.current = [...current, at];
    setWalk(walkRef.current);
  }, [recordFix, georeference]);
  // K3: med nät och kartan läst sparas sidskalet och Workerns filer för kartan utan nät.
  const mapReady = editor.mapStatus === "ready";
  useEffect(() => {
    if (!mapReady || offlineSince) return;
    void saveMapProjectShell(view.projectId).catch(error => console.error("Kartsidan kunde inte sparas för offline", error));
  }, [mapReady, offlineSince, view.projectId]);
  // K3: notiserna (ny notis vid en punkt, en notis som visas).
  const notes = useMapProjectNotes(view);
  const [noteDraft, setNoteDraft] = useState<{ at: Point; objectKey?: string | undefined }>();
  const [shownNote, setShownNote] = useState<string>();
  const mapHandle = useRef<CourseSettingMapHandle>(null);
  const position = useMapProjectPosition({ georeference, active: positionMode !== "off", recording: !!recon.recording || walk !== undefined, onFix });
  // Föreslå ritar också; servern gör ändringen till ett förslag.
  const canEdit = view.viewer.canEdit || view.viewer.canPropose;
  const canDecide = view.viewer.canDecide;
  const [shownProposal, setShownProposal] = useState<string>();
  const [shownArea, setShownArea] = useState<string>();
  /** Delområdet som just ritats och väntar på namn och kartritare. */
  const [newArea, setNewArea] = useState<readonly Point[]>();
  const [tool, setTool] = useState<Tool>("select");
  const [symbolId, setSymbolId] = useState<string>();
  const [selected, setSelected] = useState<Selected>();
  const [activeVertex, setActiveVertex] = useState<VertexAddress>();
  const [rotating, setRotating] = useState(false);
  /** K3: en linje dras hel (annars böjs sträckan man tar tag i). */
  const [moveWhole, setMoveWhole] = useState(false);
  const [preview, setPreviewState] = useState<MapObject>();
  // Kartan håller handtagen från när dragningen började: förhandsvisningen läses ur en ref, inte ur en gammal closure.
  const previewRef = useRef<MapObject | undefined>(undefined);
  const setPreviewObject = (next: MapObject | undefined | ((current: MapObject | undefined) => MapObject | undefined)) => {
    previewRef.current = typeof next === "function" ? next(previewRef.current) : next;
    setPreviewState(previewRef.current);
  };
  const selectedRef = useRef<Selected | undefined>(undefined);
  const [draft, setDraft] = useState<readonly DraftPoint[]>([]);
  const [cursor, setCursor] = useState<Point>();
  /** Telefonen: symbolerna och lagren visas bara när man ber om dem. */
  const [panelOpen, setPanelOpen] = useState(false);
  const drag = useRef<Drag | undefined>(undefined);
  const lastTap = useRef<{ at: number; point: Point } | undefined>(undefined);
  // Ägaren 2026-11-09: verktygshjulet (högerklick, långt tryck, mellanslag), de senaste symbolerna och cirkelns mitt.
  const [wheel, setWheel] = useState<{ screen: { x: number; y: number }; bounds: { width: number; height: number } }>();
  const [recent, setRecent] = useState<readonly string[]>([]);
  // Ägaren 2026-11-10: panelens flik, och bara kartan (verktygsspalten och panelen gömda) med knappen överst eller §.
  const [tab, setTab] = useState<SidebarTab>("symbols");
  const [bare, setBare] = useState(false);
  // Ägaren 2026-11-10: tangenterna under vänster hand, valbara (sparade i webbläsaren).
  const [keys, setKeys] = useMapProjectKeys();
  const [keysOpen, setKeysOpen] = useState(false);
  const keysText = useTexts(mapProjectKeysSv, mapProjectKeysEn);
  const drawingArea = !!newArea;
  useEffect(() => { if (drawingArea) setTab("review"); }, [drawingArea]);
  const [circleCenter, setCircleCenter] = useState<Point>();
  const [flash, setFlash] = useState<string>();
  const mapArea = useRef<HTMLDivElement>(null);
  const pointerAt = useRef<{ x: number; y: number }>(undefined);
  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem(recentKey(view.projectId)) ?? "[]") as unknown; if (Array.isArray(stored)) setRecent(stored.filter(id => typeof id === "string").slice(0, 9)); }
    catch { /* utan lagring: inga senaste */ }
  }, [view.projectId]);
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(undefined), 5000); return () => clearTimeout(timer); }, [flash]);

  selectedRef.current = selected;
  const symbols = useMemo(() => new Map(catalog.map(symbol => [symbol.id, symbol])), [catalog]);
  // K4b: kandidaterna ur en vektorfil (visas som förslag tills de lämnats).
  const importer = useMapProjectImport(view, georeference ?? undefined, editor.bounds ?? undefined, symbols,
    useCallback(() => { void loadProposals(); }, [loadProposals]), session, editor.commitMany);
  // K6: generaliseringen som förslag.
  const generalizer = useMapProjectGeneralize(view, session, editor.state, useCallback(() => { void loadProposals(); }, [loadProposals]));
  const rectify = useMapProjectRectify(view, session, editor.state, useCallback(() => { void loadProposals(); }, [loadProposals]));
  // Grundkartan G2b: kandidaterna ritas av Workern med sina symboler ovanpå kartan.
  const candidates = importer.candidates, showCandidates = editor.showCandidates;
  useEffect(() => { showCandidates(candidates); }, [candidates, showCandidates]);
  const symbol = symbolId ? symbols.get(symbolId) : undefined;
  // Ägaren 2026-11-09: lagren efter normen. Släckta och låsta lager går inte att markera; låsta kan visas nedtonade.
  const work = useMapProjectWorkLayers(view);
  const workGroups = useMemo(() => work.layers.filter(layer => layer.kind === "SYMBOLS").map(layer => ({ layerId: layer.layerId, codes: layer.codes })),
    [work.layers]);
  const symbolLayers = useMapProjectSymbolLayers({ projectId: view.projectId, catalog, scale: editor.scale ?? georeference?.scale, session, commit,
    work: workGroups });
  // Skisslagren som syns (och om de är tonade).
  const sketchLayers = useMemo(() => work.layers.filter(layer => layer.kind === "SKETCH" && !symbolLayers.state.work?.[layer.layerId]?.hidden)
    .map(layer => ({ color: layer.color, dimmed: symbolLayers.state.work?.[layer.layerId]?.dimmed === true,
      sketches: work.sketches.filter(sketch => sketch.layerId === layer.layerId) })), [work.layers, work.sketches, symbolLayers.state]);
  const hiddenSymbols = symbolLayers.hidden;
  const unselectable = useMemo(() => [...symbolLayers.hidden, ...symbolLayers.locked], [symbolLayers.hidden, symbolLayers.locked]);
  // Ägaren 2026-11-10: flera objekt markerade med en ruta (som i Illustrator). Mellanslag nedtryckt = dra kartan i stället.
  const multi = useMapProjectMulti({ session, hidden: unselectable, commit, setPreviewKeys: setPreview });
  const panKey = useRef({ down: false, used: false });
  const lockedSymbols = symbolLayers.locked;
  useEffect(() => { if (selected && lockedSymbols.has(selected.object.symbol)) deselect(); }, [lockedSymbols, selected]);

  const deselect = () => { setSelected(undefined); setActiveVertex(undefined); setRotating(false); setMoveWhole(false); };
  const cancelDraft = () => { setDraft([]); setPreviewObject(undefined); setCircleCenter(undefined); };

  const save = useCallback((key: ObjectKey, ref: ObjectRef | null, object: MapObject | undefined, kind: EditKind, point?: Point): boolean => {
    const ok = commit({ key, ref, kind, after: object ? { kind: "OBJECT", object } : { kind: "DELETED" }, point });
    if (ok && object) setSelected({ key, ref, object });
    if (ok && !object) deselect();
    return ok;
  }, [commit]);

  const finishDraft = useCallback(() => {
    if (tool === "area") {
      const ring = draft.map(point => point.at);
      cancelDraft();
      if (ring.length >= 3) { setNewArea(ring); setPanelOpen(true); }
      return;
    }
    if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) return;
    const object = draftObject(symbol.kind, symbol.id, draft);
    cancelDraft();
    if (object) save(newKey(crypto.randomUUID()), null, object, "ADD");
  }, [draft, symbol, save, tool]);

  const removeSelected = useCallback(() => {
    if (!selected || !canEdit) return;
    if (activeVertex && selected.object.kind !== "point" && selected.object.kind !== "text") {
      const next = deleteVertex(selected.object, activeVertex);
      if (next) { save(selected.key, selected.ref, next, "RESHAPE"); setActiveVertex(undefined); return; }
    }
    save(selected.key, selected.ref, undefined, "DELETE", anchorOf(selected.object));
  }, [selected, activeVertex, canEdit, save]);

  // Hjulet vid pekaren, eller mitt på kartan när pekaren inte har varit där (knappen i verktygsspalten).
  const openWheel = () => {
    const rect = mapArea.current?.getBoundingClientRect();
    if (canEdit && rect) setWheel({ screen: pointerAt.current ?? { x: rect.width / 2, y: rect.height / 2 }, bounds: { width: rect.width, height: rect.height } });
  };
  // Tangenterna (`use-map-project-shortcuts.ts`). Det markerade objektets kommandon sätts längre ned, där de är uträknade.
  const keyAction = useRef<(command: SelectedCommand) => void>(() => undefined);
  useMapProjectShortcuts({ keys, blocked: keysOpen, canEdit, canNote: notes.canWrite, tool, hasSelection: !!selected, drafting: draft.length > 0, recent,
    multiCount: multi.items.length, panKey, undo: editor.undo, redo: editor.redo, toggleBare: () => setBare(value => !value),
    pickTool: next => { if (next === "draw" || next === "circle") deselect(); cancelDraft(); setTool(next); },
    selectedAction: command => keyAction.current(command), chooseSymbol: id => { if (symbols.has(id)) chooseSymbol(id); },
    openWheel,
    escape: () => { if (draft.length) cancelDraft(); else { deselect(); multi.clear(); } }, finishDraft,
    dropDraftPoint: () => setDraft(points => points.slice(0, -1)), remove: () => { if (multi.items.length) multi.remove(); else removeSelected(); } });

  function chooseSymbol(id: string) {
    setSymbolId(id);
    setPanelOpen(false);
    setRecent(current => {
      const next = withRecent(current, id);
      try { localStorage.setItem(recentKey(view.projectId), JSON.stringify(next)); } catch { /* utan lagring */ }
      return next;
    });
    if (canEdit && !selected && multi.items.length === 0 && tool !== "circle") { setTool("draw"); cancelDraft(); }
  }

  /** Formens åtgärd på det markerade objektet (förenkla, mjuk, rak) med beskedet. */
  function reshape(result: MapObject | undefined, message: string) {
    if (!selected || !canEdit) return;
    if (result) { save(selected.key, selected.ref, result, "RESHAPE"); setActiveVertex(undefined); }
    setFlash(message);
  }
  function placeCircle(center: Point, edge: Point) {
    if (!symbol) return;
    const object = circleFor(symbol.kind, symbol.id, center, edge);
    setCircleCenter(undefined); setPreviewObject(undefined);
    if (object) save(newKey(crypto.randomUUID()), null, object, "ADD");
  }

  const handlers: MapPointerHandlers = {
    unlifted: tool === "draw" || tool === "area" || tool === "circle" || !!work.drawing,
    onTap(point, tolerance, modifiers) {
      if (control.active) { control.click(point); return; }
      if (rectify.picking) { rectify.click(point); return; }
      if (work.drawing) { work.tap(point); return; }
      const now = performance.now();
      const previous = lastTap.current;
      const double = !!previous && now - previous.at < DOUBLE_TAP_MS && Math.hypot(previous.point.x - point.x, previous.point.y - point.y) < tolerance * 2;
      lastTap.current = double ? undefined : { at: now, point };
      if (tool === "note") {
        setShownNote(undefined);
        setNoteDraft({ at: point, objectKey: selected && hitDistance(selected.object, point, tolerance) ? selected.key : undefined });
        return;
      }
      if (tool === "select") {
        const note = noteAt(notes.notes, point, tolerance, modifiers.pxPerMm);
        if (note) { setShownNote(note.noteId); setNoteDraft(undefined); return; }
      }
      if (tool === "area") {
        const first = draft[0];
        if (double || (first && draft.length >= 3 && Math.hypot(first.at.x - point.x, first.at.y - point.y) <= tolerance)) { finishDraft(); return; }
        setDraft(points => [...points, { at: point }]);
        return;
      }
      if (tool === "circle" && canEdit) {
        if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) { setFlash(quick.circleNeedsShape); return; }
        if (circleCenter) placeCircle(circleCenter, point); else setCircleCenter(point);
        return;
      }
      if (tool === "draw" && canEdit) {
        if (!symbol) return;
        if (symbol.kind === "point") { save(newKey(crypto.randomUUID()), null, { kind: "point", symbol: symbol.id, at: point, angle: 0 }, "ADD"); return; }
        if (symbol.kind === "text") return;
        if (double) { finishDraft(); return; }
        const first = draft[0];
        if (symbol.kind === "area" && first && draft.length >= 3 && Math.hypot(first.at.x - point.x, first.at.y - point.y) <= tolerance) { finishDraft(); return; }
        setDraft(points => [...points, { at: point }]);
        return;
      }
      // Skift+klick lägger till eller tar bort ett objekt i markeringen; ett vanligt klick släpper den.
      if (tool === "select" && modifiers.free && canEdit) {
        session?.hit(point, tolerance, unselectable, hits => { if (hits[0]) { multi.toggle(hits[0], selected); deselect(); } });
        return;
      }
      multi.clear();
      // Saxen, Lägg till punkt, Ta bort punkt och Cmd/Ctrl+klick i Redigera (`map-project-click-tools.ts`).
      if (canEdit && clickTool({ tool, command: modifiers.command, point, tolerance, selected, session, hidden: unselectable, commit, save, text: keysText, setFlash,
        onEdited: (target, address) => { setSelected(target); setActiveVertex(address); setRotating(false); } })) return;
      // Redigera: dubbelklick på en punkt tar bort den, på en sträcka (rak eller kurva) ger det en ny punkt; annars markera (klick
      // igen på samma ställe tar nästa objekt under).
      if (double && selected && canEdit && selected.object.kind !== "point" && selected.object.kind !== "text") {
        const result = editPointAt(selected.object, point, tolerance, "EITHER");
        if (result) { save(selected.key, selected.ref, result.object, "RESHAPE"); setActiveVertex(result.address); return; }
        if (nearestVertex(selected.object, point, tolerance)) return;
      }
      if (selected && selected.object.kind !== "point" && selected.object.kind !== "text") {
        const vertex = nearestVertex(selected.object, point, tolerance);
        if (vertex) { setActiveVertex({ part: vertex.part, index: vertex.index }); return; }
        // K3: ett klick på den markerade linjens kant behåller markeringen (dubbelklick för en ny punkt ska inte byta objekt);
        // objektet under nås med Alt-klick eller ett klick inne i en yta.
        if (!modifiers.alt && nearestSegment(selected.object, point, tolerance)) { setActiveVertex(undefined); return; }
      }
      session?.hit(point, tolerance, unselectable, hits => {
        if (hits.length === 0) { deselect(); return; }
        const at = selected ? hits.findIndex(hit => hit.key === selected.key) : -1;
        const next = hits[at >= 0 ? (at + 1) % hits.length : 0]!;
        setSelected({ key: next.key, ref: next.ref, object: next.object });
        setActiveVertex(undefined);
        setRotating(false);
      });
    },
    onDragStart(point, tolerance, pointerType) {
      if (control.active || rectify.picking) return false;
      if (work.drawing) return work.dragStart(point);
      if (!canEdit || tool === "area") return false;
      if (tool === "circle") {
        if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) return false;
        drag.current = { mode: "circle", center: circleCenter ?? point };
        return true;
      }
      if (tool === "draw") {
        if (!symbol || symbol.kind === "text") return false;
        if (symbol.kind === "point") { drag.current = { mode: "place", at: point }; setPreviewObject({ kind: "point", symbol: symbol.id, at: point, angle: 0 }); return true; }
        drag.current = { mode: "handle" };
        setDraft(points => [...points, { at: point, handle: { x: 0, y: 0 } }]);
        return true;
      }
      if (tool === "select" && multi.items.length && multi.grab(point, tolerance)) return true;
      // Ett drag på tom karta med musen ritar en ruta som markerar; med mellanslag nedtryckt (och med fingret) flyttas kartan.
      const marquee = () => {
        if (tool !== "select" || pointerType === "touch" || panKey.current.down) { panKey.current.used = true; return false; }
        deselect(); multi.startMarquee(point);
        return true;
      };
      if (!selected) return marquee();
      const object = selected.object;
      if (rotating && (object.kind === "point" || object.kind === "text")) { drag.current = { mode: "rotate", original: object }; setPreview(new Set([selected.key])); return true; }
      if (object.kind !== "point" && object.kind !== "text") {
        // Den aktiva punktens styrpunkter först (de ligger ofta nära punkten).
        const handles = activeVertex ? vertexHandles(object, activeVertex) : undefined;
        for (const which of ["in", "out"] as const) {
          const handle = handles?.[which];
          if (activeVertex && handle && Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) {
            drag.current = { mode: "curveHandle", address: activeVertex, which, original: object };
            setPreview(new Set([selected.key]));
            return true;
          }
        }
        const vertex = nearestVertex(object, point, tolerance);
        if (vertex) {
          drag.current = { mode: "vertex", address: { part: vertex.part, index: vertex.index }, original: object };
          setActiveVertex({ part: vertex.part, index: vertex.index });
          setPreview(new Set([selected.key]));
          return true;
        }
      }
      // En sträcka böjs där man tar tag (en linje dras hel med "Flytta hela"; en yta dras hel inifrån).
      const segmentHit = moveWhole ? undefined : nearestSegment(object, point, tolerance);
      if (segmentHit) {
        drag.current = { mode: "bend", address: segmentHit, t: segmentHit.t, start: segmentHit.at, original: object };
        setPreview(new Set([selected.key]));
        return true;
      }
      if (hitDistance(object, point, tolerance)) {
        drag.current = { mode: "object", start: point, original: object };
        setPreview(new Set([selected.key]));
        return true;
      }
      return marquee();
    },
    onDragMove(point) {
      if (work.dragging) { work.dragMove(point); return; }
      if (multi.dragging()) { multi.dragMove(point); return; }
      const current = drag.current;
      if (!current) return;
      if (current.mode === "handle") {
        setDraft(points => {
          const last = points[points.length - 1];
          return last ? [...points.slice(0, -1), { at: last.at, handle: { x: point.x - last.at.x, y: point.y - last.at.y } }] : points;
        });
        return;
      }
      if (current.mode === "place") {
        setPreviewObject(object => object ? rotatePoint(object, degreesTo(current.at, point)) : object);
        return;
      }
      if (current.mode === "circle") { if (symbol) setPreviewObject(circleFor(symbol.kind, symbol.id, current.center, point)); return; }
      if (current.mode === "bend") { setPreviewObject(bendSegment(current.original, current.address, current.t,
        { x: point.x - current.start.x, y: point.y - current.start.y })); return; }
      if (current.mode === "curveHandle") { setPreviewObject(moveHandle(current.original, current.address, current.which, point)); return; }
      if (current.mode === "vertex") setPreviewObject(moveVertex(current.original, current.address, point));
      else if (current.mode === "object") setPreviewObject(translateObject(current.original, { x: point.x - current.start.x, y: point.y - current.start.y }));
      else if (current.original.kind === "point" || current.original.kind === "text") setPreviewObject(rotatePoint(current.original, degreesTo(current.original.at, point)));
    },
    onDragEnd() {
      if (work.dragging) { work.dragEnd(); return; }
      if (multi.dragging()) { multi.dragEnd(); return; }
      const current = drag.current;
      drag.current = undefined;
      const moved = previewRef.current;
      const target = selectedRef.current;
      setPreviewObject(undefined);
      setPreview(new Set());
      if (!current) return;
      if (current.mode === "handle") {
        // En dragning som nästan inte rörde sig blir en hörnpunkt.
        setDraft(points => {
          const last = points[points.length - 1];
          if (!last?.handle || Math.hypot(last.handle.x, last.handle.y) > 0.05) return points;
          return [...points.slice(0, -1), { at: last.at }];
        });
        return;
      }
      if (current.mode === "place") { if (moved) save(newKey(crypto.randomUUID()), null, moved, "ADD"); return; }
      if (current.mode === "circle") { setCircleCenter(undefined); if (moved) save(newKey(crypto.randomUUID()), null, moved, "ADD"); return; }
      if (!target || !moved) return;
      save(target.key, target.ref, moved, current.mode === "object" || current.mode === "rotate" ? "MOVE" : "RESHAPE");
    },
    onDragCancel() { multi.cancel(); drag.current = undefined; setPreviewObject(undefined); setPreview(new Set()); },
    onHover(point, modifiers) {
      if (tool === "select" && multi.items.length) multi.hover(point, 8 / modifiers.pxPerMm);
      if (tool !== "select" && (draft.length || circleCenter)) setCursor(point);
      if (tool === "circle" && circleCenter && point && symbol) setPreviewObject(circleFor(symbol.kind, symbol.id, circleCenter, point));
    },
    // Ägaren 2026-11-09: högerklick avslutar det som ritas (som i Mapper), annars öppnas verktygshjulet. Ett objekt under
    // pekaren markeras först, så att hjulets åtgärder gäller det.
    onContextMenu(point, screen, tolerance) {
      if (!canEdit) return;
      if (draft.length) { finishDraft(); return; }
      const rect = mapArea.current?.getBoundingClientRect();
      const open = () => setWheel({ screen, bounds: { width: rect?.width ?? 800, height: rect?.height ?? 600 } });
      if (tool !== "select" || (selected && hitDistance(selected.object, point, tolerance)) || multi.zoneAt(point, tolerance) === "move") { open(); return; }
      multi.clear();
      session?.hit(point, tolerance, unselectable, hits => {
        // Det markerade objektet under pekaren behålls; annars det översta.
        const next = (selected && hits.find(hit => hit.key === selected.key)) ?? hits[0];
        if (next) { setSelected({ key: next.key, ref: next.ref, object: next.object }); setActiveVertex(undefined); setRotating(false); }
        open();
      });
    }
  };

  // Öppna förslag streckade (de egna direkt efter synken, andras ur listan); förslaget som visas heldraget.
  const proposedOpen = useMemo(() => proposedDrawing([
    ...Object.values(editor.state?.proposed ?? {}).filter(entry => entry.proposalId !== shownProposal),
    ...collab.proposals.filter(proposal => proposal.status === "OPEN" && proposal.proposalId !== shownProposal).flatMap(proposal => proposal.edits)
  ]), [editor.state?.proposed, collab.proposals, shownProposal]);
  const proposedShown = useMemo(() => proposedDrawing(collab.proposals.find(proposal => proposal.proposalId === shownProposal)?.edits ?? []),
    [collab.proposals, shownProposal]);
  const [stages, setStages] = useState(false);
  const areaDrawings = useMemo((): AreaDrawing[] => [
    ...collab.areas.map(area => ({ polygon: area.polygon, selected: area.areaId === shownArea,
      label: stages ? text.collab.stageLabel(area.name, area.revisedOn) : area.name,
      fill: stages ? STAGE_COLORS[stageAge(area.revisedOn, new Date())] : undefined,
      owner: !area.assignee ? "NONE" as const : area.assignee.accountId === view.viewer.accountId ? "MINE" as const : "OTHER" as const })),
    ...(newArea ? [{ polygon: [newArea], label: "", owner: "MINE" as const, selected: true }] : [])
  ], [collab.areas, shownArea, newArea, view.viewer.accountId, stages]);

  const reconResult = recon.result;
  const coverage = useMemo(() => reconResult?.coverage && recon.layers.has("COVERAGE")
    ? { grid: reconResult.coverage, image: coverageImage(reconResult.coverage) } : undefined, [reconResult, recon.layers]);
  const gapMm = editor.georeference ? MAX_SEGMENT_M / metersPerMm(editor.georeference, editor.georeference.scale) : Infinity;
  const overlay = useCallback((ctx: CanvasRenderingContext2D, current: Viewport) => {
    const shown = preview ?? selected?.object;
    drawLayers(ctx, current, drawnLayers);
    if (coverage?.image) drawCoverage(ctx, current, coverage.grid, coverage.image);
    if (recon.layers.has("TRACKS")) drawTracks(ctx, current, recon.trackLines.others, recon.trackLines.recording, gapMm);
    if (walk && walk.length > 0) drawTracks(ctx, current, [], walk.map(point => ({ ...point, accuracyM: 0 })), Infinity);
    if (view.area) drawMapArea(ctx, current, view.area);
    drawAreas(ctx, current, areaDrawings);
    drawProposed(ctx, current, proposedOpen.objects, proposedOpen.deleted, false);
    drawProposed(ctx, current, proposedShown.objects, proposedShown.deleted, true);
    if (tool === "area" && draft.length) {
      const ring = cursor ? [...draft.map(point => point.at), cursor] : draft.map(point => point.at);
      if (ring.length >= 2) drawAreas(ctx, current, [{ polygon: [ring], label: "", owner: "MINE" }]);
      drawDraftPoints(ctx, current, draft, cursor);
    }
    if (preview) drawPreview(ctx, current, preview, symbols.get(preview.symbol));
    if (tool === "circle" && circleCenter) drawDraftPoints(ctx, current, [{ at: circleCenter }], cursor);
    if (tool === "draw" && symbol && draft.length) {
      const tentative = cursor ? [...draft, { at: cursor }] : draft;
      const object = symbol.kind === "line" || symbol.kind === "area" ? draftObject(symbol.kind, symbol.id, tentative) : undefined;
      if (object) drawPreview(ctx, current, object, symbol);
      drawDraftPoints(ctx, current, draft, cursor);
    }
    if (reconResult && recon.layers.has("STATUS")) drawReconMarkers(ctx, current, reconResult.markers, SHOWN_STATUSES);
    if (normIssues) drawNormIssues(ctx, current, normIssues, shownIssue);
    drawNotes(ctx, current, notes.notes, shownNote);
    if (sketchLayers.length || work.dragging) drawSketches(ctx, current, sketchLayers, work.drawingLayer && { color: work.drawingLayer.color, points: work.stroke });
    if (control.active) drawControlPoints(ctx, current, control.markers);
    if (rectify.shown.length) drawProposed(ctx, current, rectify.shown, [], true);
    if (rectify.markers.length) drawControlPoints(ctx, current, rectify.markers);
    if (noteDraft) drawNotes(ctx, current, [{ noteId: "", at: noteDraft.at, status: "OPEN", pending: true }], "");
    if (multi.moving) for (const object of multi.shown) drawPreview(ctx, current, object, symbols.get(object.symbol));
    if (multi.box && multi.items.length) drawMultiSelection(ctx, current, multi.shown, multi.box);
    if (multi.marquee) drawMarquee(ctx, current, multi.marquee);
    if (shown && tool === "select" && selected) {
      drawSelection(ctx, current, shown, activeVertex);
      const handles = activeVertex ? vertexHandles(shown, activeVertex) : undefined;
      if (handles) drawHandles(ctx, current, handles);
    }
  }, [preview, selected, symbols, tool, symbol, draft, cursor, circleCenter, activeVertex, areaDrawings, proposedOpen, proposedShown, view.area, coverage, recon.layers,
    recon.trackLines, reconResult, walk, gapMm, notes.notes, shownNote, noteDraft, drawnLayers, candidates, normIssues, shownIssue,
    control.active, control.markers, rectify.shown, rectify.markers, sketchLayers, work.dragging, work.drawingLayer, work.stroke,
    multi.moving, multi.shown, multi.box, multi.items.length, multi.marquee]);

  const hint = !canEdit ? (view.status === "CLOSED" ? text.closed : text.readOnly)
    : tool === "area" ? text.collab.areaHint
    : tool === "note" ? notesText.toolHint
    : tool === "addPoint" ? keysText.addPointHint : tool === "removePoint" ? keysText.removePointHint : tool === "cut" ? keysText.cutHint
    : tool === "select" && multi.items.length ? (multi.zone === "rotate" ? keysText.multiRotate : keysText.multiSelected(multi.items.length))
    : tool === "select" ? text.hints.select
    : !symbol ? text.tools.noSymbol
    : tool === "circle" ? (symbol.kind === "line" || symbol.kind === "area" ? quick.circleHint(symbol.code) : quick.circleNeedsShape)
    : symbol.kind === "point" ? text.hints.drawPoint(symbol.code)
    : symbol.kind === "line" ? text.hints.drawLine(symbol.code)
    : symbol.kind === "area" ? text.hints.drawArea(symbol.code) : text.tools.textNotSupported;
  const selectedSymbol = selected ? symbols.get(selected.object.symbol) : undefined;
  const hintLine = control.active ? (control.pending ? layersText.control.hintMap : layersText.control.hintImage)
    : rectify.picking ? (rectify.pending ? rectifyText.hintTo : rectifyText.hintFrom)
    : work.drawingLayer ? workText.hint(work.drawingLayer.name) : flash ?? `${selectedSymbol && tool === "select" ? `${selectedSymbol.code} ${selectedSymbol.name} · ` : ""}${hint}`;
  const canSwitch = !!selected && !!symbol && symbol.id !== selected.object.symbol && symbol.kind === selected.object.kind && canEdit;
  // Ägaren 2026-11-09: formens åtgärder för det markerade objektet (i hjulet och i verktygsraden).
  const shapes = selected && tool === "select" && canEdit ? shapeActions(selected.object, quick) : [];
  const pickTool = (next: Tool) => () => { if (next !== "select") deselect(); cancelDraft(); setTool(next); };
  const wheelTools = wheelToolsOf(keys, keysText.space, quick.tools, tool, notes.canWrite, next => pickTool(next)());
  const wheelActions: WheelAction[] = multi.items.length && canEdit ? [
    ...(symbol && multi.switchable(symbol) ? [{ id: "switch", label: keysText.multiSwitch(multi.switchable(symbol), symbol.code), onPick: () => keyAction.current("switchSymbol") }] : []),
    ...(multi.joinable(JOIN_MM) ? [{ id: "join", label: keysText.commands.join, onPick: () => keyAction.current("join") }] : []),
    { id: "remove", label: keysText.multiRemove(multi.items.length), onPick: multi.remove }]
    : selected && tool === "select" && canEdit ? [
    ...shapes.map(action => ({ id: action.id, label: action.label, disabled: !action.result, onPick: () => reshape(action.result, action.message) })),
    ...(canSwitch ? [{ id: "switch", label: quick.switchTo(symbol.code), onPick: () => save(selected.key, selected.ref, withSymbol(selected.object, symbol.id), "SYMBOL") }] : []),
    ...(selected.object.kind === "line" ? [{ id: "reverse", label: keysText.commands.reverse, onPick: () => keyAction.current("reverse") }] : []),
    { id: "remove", label: quick.remove, onPick: removeSelected }
  ] : [];
  const pending = editor.state?.pending.length ?? 0;
  const conflicts = editor.state ? Object.values(editor.state.conflicts) : [];

  const multiSwitch = symbol && canEdit ? multi.switchable(symbol) : 0;
  const act = (command: SelectedCommand) => {
    if (multi.items.length) {
      if (command === "switchSymbol" && symbol && multiSwitch) setFlash(keysText.switched(multi.switchSymbol(symbol), symbol.code));
      else if (command === "join") { const count = multi.join(JOIN_MM); setFlash(count ? keysText.joined(count) : keysText.needLines); }
      else if (command === "reverse") { const count = multi.reverse(); setFlash(count ? keysText.reversed(count) : keysText.needLine); }
      return;
    }
    if (!selected) return;
    const shape = command === "simplify" || command === "smooth" ? shapes.find(action => action.id === command) : undefined;
    if (shape) reshape(shape.result, shape.message);
    else if (command === "switchSymbol" && canSwitch) save(selected.key, selected.ref, withSymbol(selected.object, symbol.id), "SYMBOL");
    else if (command === "reverse") { const turned = reverseLine(selected.object); if (turned && save(selected.key, selected.ref, turned, "RESHAPE")) setFlash(keysText.reversed(1)); }
    else if (command === "pick") { chooseSymbol(selected.object.symbol); setFlash(keysText.picked(symbols.get(selected.object.symbol)?.code ?? "")); }
    else if (command === "checked" && recon.canRecord) void recon.setChecked([selected.key], !recon.validChecks.has(selected.key));
  };
  keyAction.current = act;
  const rail = railTools({ keys, text: keysText, tool, panelOpen, bare, canEdit, canDecide, canNote: notes.canWrite, canCheck: recon.canRecord,
    labels: { panel: text.panel, select: text.tools.select, selectHelp: text.tools.selectHelp, draw: text.tools.draw, drawHelp: text.tools.drawHelp, circle: quick.tools.circle,
      area: text.collab.areaTool, note: notesText.tool, undo: text.tools.undo, redo: text.tools.redo, checked: keysText.commands.checked,
      switchTo: symbol && (canSwitch || multiSwitch) ? text.tools.switchSymbol(symbol.code) : undefined },
    isChecked: !!selected && recon.validChecks.has(selected.key), canUndo: editor.history.undo.length > 0, canRedo: editor.history.redo.length > 0,
    hasSelection: tool === "select" && (!!selected || multi.items.length > 0), canSwitch: canSwitch || multiSwitch > 0, canJoin: canEdit && multi.joinable(JOIN_MM),
    canReverse: canEdit && tool === "select" && (selected ? selected.object.kind === "line" : multi.items.some(item => item.object.kind === "line")),
    canPick: tool === "select" && !!selected && selected.object.symbol !== symbolId,
    canSmooth: shapes.some(action => action.id === "smooth" && action.result), canSimplify: shapes.some(action => action.id === "simplify" && action.result),
    pick: next => { if (next === "select" || next === "addPoint" || next === "removePoint" || next === "cut") { cancelDraft(); setTool(next); }
      else if (next === "note") { cancelDraft(); setTool(tool === "note" ? "select" : "note"); } else pickTool(next)(); },
    act, remove: () => { if (multi.items.length) multi.remove(); else removeSelected(); }, undo: editor.undo, redo: editor.redo,
    togglePanel: () => setPanelOpen(open => !open), toggleBare: () => setBare(value => !value), openWheel, openKeys: () => setKeysOpen(true) });

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.title}>
        <Link href={`/organizer/map-projects/${encodeURIComponent(view.projectId)}`}>‹ {text.back}</Link>
        <h1>{view.name}</h1>
      </div>
      <SyncBadge sync={editor.sync} pending={pending} />
      <button type="button" className={styles.bareToggle} aria-pressed={bare} title={keys.bare ? `${quick.bareHelp} (${keyLabel(keys.bare, keysText.space)})` : quick.bareHelp} data-testid="map-project-bare"
        onClick={() => setBare(value => !value)}>{bare ? quick.showPanels : quick.hidePanels}</button>
      <HelpButton view="MAP_EDITOR" compact />
      <AccountMenu />
    </header>
    {offlineSince && <p className={styles.offline} role="status" data-testid="map-project-offline">
      {text.offline(new Date(offlineSince).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</p>}
    {editor.notice && <div className={styles.notice}><Notice tone="attention" role="status">{noticeText(editor.notice, text)}{" "}
      <Button variant="quiet" onClick={() => editor.setNotice(undefined)}>{text.ok}</Button></Notice></div>}
    {keysOpen && <MapProjectKeysDialog keys={keys} onKeys={setKeys} onClose={() => setKeysOpen(false)} />}
    <div className={styles.workspace} data-bare={bare}>
      <MapProjectToolRail label={text.tools.label} tools={rail} spaceLabel={keysText.space} />
      <div className={styles.mapArea} ref={mapArea} onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerAt.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      }}>
        {wheel && <MapProjectToolWheel at={wheel.screen} bounds={wheel.bounds} tools={wheelTools}
          symbols={recent.map(id => symbols.get(id)).filter((entry): entry is CatalogSymbol => entry !== undefined).slice(0, 6)}
          symbolId={symbolId} onSymbol={chooseSymbol} actions={wheelActions} onClose={() => setWheel(undefined)} />}
        {editor.mapStatus === "loading" && <p className={styles.loading}>{text.loading}</p>}
        {editor.mapStatus === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
        {/* Kartvyn visas när kartan är läst: då har rutan sin storlek och hela kartan passas in. */}
        {editor.bounds && <div className={styles.frame}><CourseSettingMap session={session} mapBounds={editor.bounds} primitives={[]} faded={[]} marks={NO_MARKS} analysis={undefined}
          label={text.mapLabel} cursor={tool === "draw" || tool === "circle" || tool === "addPoint" || tool === "removePoint" || tool === "cut" ? "crosshair" : "default"} handlers={handlers} overlayExtra={overlay}
          cursorAt={tool === "select" && multi.items.length ? (point, tolerance) => {
            const zone = multi.zoneAt(point, tolerance);
            return zone === "move" ? "move" : zone === "rotate" ? ROTATE_CURSOR : undefined;
          } : undefined}
          renderKey={editor.renderKey} hiddenSymbols={hiddenSymbols} dimmedSymbols={symbolLayers.dimmed}
          position={position.position && positionMode !== "off" ? { position: position.position, follow: positionMode === "follow" } : undefined}
          onPan={() => setPositionMode(mode => mode === "follow" ? "on" : mode)} handle={mapHandle} /></div>}
        {editor.mapStatus === "ready" && georeference && <MapProjectFieldControls mode={positionMode} onMode={setPositionMode} problem={position.problem}
          canRecord={recon.canRecord} recording={!!recon.recording}
          note={notes.canWrite && position.position ? () => { setShownNote(undefined); setNoteDraft({ at: position.position!.at }); } : undefined}
          onRecord={() => { if (recon.recording) void recon.stopRecording();
            else void recon.startRecording(reconText.recordDefault(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))); }}
          point={canEdit && symbol?.kind === "point" && position.position ? { code: symbol.code, onPlace: () => {
            save(newKey(crypto.randomUUID()), null, { kind: "point", symbol: symbol.id, at: position.position!.at, angle: 0 }, "ADD"); } } : undefined}
          walk={canEdit && symbol?.kind === "line" && (position.position || walk) ? { code: symbol.code, walking: walk?.length,
            onStart: () => { walkRef.current = position.position ? [position.position.at] : []; setWalk(walkRef.current); },
            onStop: () => {
              const points = walkRef.current ?? [];
              walkRef.current = undefined; setWalk(undefined);
              const object = points.length >= 2 ? draftObject("line", symbol.id, points.map(at => ({ at }))) : undefined;
              if (object) save(newKey(crypto.randomUUID()), null, object, "ADD");
            } } : undefined} />}
        {noteDraft && <NoteForm onCancel={() => setNoteDraft(undefined)} onSave={async (value, photo) => {
          await notes.create(noteDraft.at, value, photo, noteDraft.objectKey);
          setNoteDraft(undefined);
          if (tool === "note") setTool("select");
        }} />}
        {!noteDraft && shownNote && (() => {
          const note = notes.notes.find(row => row.noteId === shownNote);
          return note ? <NoteDetail note={note} canManage={notes.canManage(note)} onClose={() => setShownNote(undefined)}
            onStatus={status => void notes.setStatus(note.noteId, status)}
            onRemove={() => void notes.remove(note.noteId).then(ok => { if (ok) setShownNote(undefined); })} /> : null;
        })()}
      </div>
      <div className={styles.statusRow}>
        {canEdit && (work.drawingLayer || draft.length > 0 || (selected && tool === "select") || multi.items.length > 0) && <div className={styles.objectBar} role="group"
          aria-label={quick.actions} data-testid="map-project-object-bar">
          {multi.items.length > 0 && <Button variant="secondary" onClick={multi.remove} data-testid="map-project-multi-remove">
            {keysText.multiRemove(multi.items.length)}</Button>}
          {multiSwitch > 0 && symbol && <Button variant="secondary" onClick={() => act("switchSymbol")} data-testid="map-project-multi-switch">
            {keysText.multiSwitch(multiSwitch, symbol.code)}</Button>}
          {multi.items.length > 1 && multi.joinable(JOIN_MM) && <Button variant="secondary" onClick={() => act("join")} data-testid="map-project-multi-join">
            {keysText.commands.join}</Button>}
          {work.drawingLayer && <>
            <label className={styles.inlineField}>{workText.textLabel}<input value={work.label} maxLength={200} onChange={event => work.setLabel(event.target.value)}
              data-testid="map-project-sketch-text" /></label>
            <Button variant="secondary" disabled={!work.canUndo} onClick={work.undo}>{workText.undo}</Button>
            <Button onClick={work.stop} data-testid="map-project-sketch-done">{workText.done}</Button>
          </>}
          {draft.length > 0 && <>
            <Button onClick={finishDraft}>{text.tools.finish}</Button>
            <Button variant="secondary" onClick={cancelDraft}>{text.tools.cancel}</Button>
          </>}
          {selected && tool === "select" && <>
            <Button variant="secondary" onClick={removeSelected}>{activeVertex ? text.tools.deleteVertex : text.tools.delete}</Button>
            {selected.object.kind === "line" && !activeVertex && <Button variant={moveWhole ? "primary" : "secondary"} aria-pressed={moveWhole}
              title={text.tools.moveWholeHelp} onClick={() => setMoveWhole(value => !value)} data-testid="map-project-move-whole">{text.tools.moveWhole}</Button>}
            {(selected.object.kind === "point") && <Button variant={rotating ? "primary" : "secondary"} aria-pressed={rotating}
              title={text.tools.rotateHelp} onClick={() => setRotating(value => !value)}>{text.tools.rotate}</Button>}
            {shapes.filter(action => action.id !== "simplifyMore").map(action => <Button key={action.id} variant="secondary" disabled={!action.result} data-testid={`map-project-shape-${action.id}`}
              onClick={() => reshape(action.result, action.message)}>{action.label}</Button>)}
            {canSwitch && <Button variant="secondary" onClick={() => save(selected.key, selected.ref, withSymbol(selected.object, symbol.id), "SYMBOL")}>
              {text.tools.switchSymbol(symbol.code)}</Button>}
            {recon.canRecord && <Button variant={recon.validChecks.has(selected.key) ? "primary" : "secondary"} aria-pressed={recon.validChecks.has(selected.key)}
              data-testid="recon-check" title={recon.validChecks.has(selected.key) ? reconText.checkedBy(recon.checks.get(selected.key)?.name ?? null,
                new Date(recon.checks.get(selected.key)?.at ?? Date.now()).toLocaleDateString(locale, { day: "numeric", month: "short" })) : undefined}
              onClick={() => void recon.setChecked([selected.key], !recon.validChecks.has(selected.key))}>
              {recon.validChecks.has(selected.key) ? reconText.checked : reconText.unchecked}</Button>}
          </>}
        </div>}
        <p className={styles.hint} aria-live="polite" data-testid="map-project-hint" title={hintLine}>{hintLine}</p>
      </div>
      <MapProjectSidebar open={panelOpen} catalog={catalog} symbolId={symbolId} onSymbol={chooseSymbol} tab={tab} onTab={setTab}
        recent={recent.map(id => symbols.get(id)).filter((entry): entry is CatalogSymbol => entry !== undefined)}
        standardSymbols={symbolLayers.standardSymbols} layerState={symbolLayers.state} conflicts={conflicts} symbols={symbols} onResolve={editor.resolve} canEdit={canEdit}
        layers={<>
          <MapProjectSymbolLayers catalog={catalog} standard={symbolLayers.standard} standardSymbols={symbolLayers.standardSymbols}
          state={symbolLayers.state} onState={symbolLayers.update} canEdit={canEdit} onMerge={symbolLayers.merge}
          merging={symbolLayers.merging} message={symbolLayers.message} work={workGroups}
          workPanel={<MapProjectWorkLayers work={work} catalog={catalog} state={symbolLayers.state} onState={symbolLayers.update} />} />
          {georeference && <MapProjectUnderlayPanels view={view} georeference={georeference} bounds={editor.bounds ?? undefined} areas={collab.areas}
            layers={layers} control={control} importer={importer} symbols={symbols} work={work} />}
          {georeference && <MapProjectNorthPanel georeference={georeference} northLines={editor.northLines} />}
          <MapProjectColors colors={editor.colors} saved={editor.colorChanges} canChange={canDecide} ocad={view.base.format === "OCD"} onShow={editor.showColors} onSave={editor.saveColors} />
        </>}
        review={<>
        <MapProjectCollabPanel view={view} collab={collab} shownProposal={shownProposal} onShowProposal={setShownProposal}
          shownArea={shownArea} onShowArea={setShownArea} newArea={!!newArea}
          onNewArea={() => { deselect(); cancelDraft(); setTool("area"); setPanelOpen(false); }}
          onSaveArea={(name, assignee) => {
            if (!newArea) return;
            void collab.createArea(name, [newArea], assignee).then(ok => { if (ok) { setNewArea(undefined); setTool("select"); } });
          }}
          onCancelArea={() => { setNewArea(undefined); setTool("select"); }} stages={stages} onStages={setStages} />
          <NotesPanel notes={notes.notes} problem={notes.problem} onShow={note => { setShownNote(note.noteId); setPanelOpen(false); mapHandle.current?.focus(note.at); }} />
          <MapProjectReconPanel view={view} recon={recon} hasGeoreference={!!georeference} />
          <MapProjectNormPanel norm={norm} onShow={issue => { setShownIssue(issue.at); setPanelOpen(false); mapHandle.current?.focus(issue.at); }} />
        </>}
        process={<>
          <MapProjectGeneralizePanel generalize={generalizer} areas={collab.areas} />
          {georeference && <MapProjectRectifyPanel rectify={rectify} areas={collab.areas} scale={georeference.scale} />}
        </>} />
    </div>
  </main>;
}

export type { CatalogSymbol };
