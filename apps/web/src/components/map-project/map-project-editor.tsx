"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapProjectKeysEn, mapProjectNotesEn, mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { mapProjectEditorEn, mapProjectLayersEn } from "../../i18n/map-project-en";
import { mapProjectReconEn, mapProjectRectifyEn, mapProjectWorkLayersEn } from "../../i18n/map-project-more-en";
import { useTexts, useLocale } from "../language-provider";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapObject, Point } from "@o-tid/map-file";
import {
  MAX_SEGMENT_M, bendSegment, deleteVertex, hitDistance, isSprintNorm, mapNorm, moveHandle, moveVertex, nearestSegment, newKey, objectBox, vertexHandles,
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
import { useMapProjectSplit } from "./use-map-project-split";
import { useMapProjectFill } from "./use-map-project-fill";
import { MapProjectAreaProposalBar } from "./map-project-area-proposal-bar";
import { mapProjectRectifySv } from "../../i18n/map-project-rectify-sv";
import { useMapProjectNorm } from "./use-map-project-norm";
import { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import { NoteForm, NotesPanel, ShownNoteDetail } from "./map-project-notes";
import { useMapProjectNotes } from "./use-map-project-notes";
import { metersPerMm } from "../../lib/course-setting-geo";
import { mapProjectReconSv } from "../../i18n/map-project-recon-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { MapProjectSymbolLayers } from "./map-project-symbol-layers";
import { useMapProjectSymbolLayers } from "./use-map-project-symbol-layers";
import { useMapProjectWorkLayers } from "./use-map-project-work-layers";
import { MapProjectWorkLayers } from "./map-project-work-layers";
import { drawSketches } from "../../lib/map-project-sketch";
import { proposedDrawing } from "../../lib/map-project-proposed";
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
import { useMapProjectPosition } from "./use-map-project-position";
import { useMapProjectRecon } from "./use-map-project-recon";
import { saveMapProjectShell } from "../../lib/map-project-offline";
import { MapProjectSidebar, type SidebarTab } from "./map-project-sidebar";
import { noticeText, SyncBadge } from "./map-project-sync-badge";
import { MapProjectBaseMapPanel, MapProjectSettingsDetails, MapProjectToExport } from "./map-project-underlay-panels";
import { MapProjectLayersPanel } from "./map-project-layers-panel";
import { MapProjectCandidateBar } from "./map-project-candidate-bar";
import { clickTool } from "./map-project-click-tools";
import { MapProjectColors } from "./map-project-colors";
import { railTools, selectionLabel, toolHint, toolName, wheelToolsOf } from "./map-project-rail-tools";
import { useMapProjectActions } from "./use-map-project-actions";
import { MapProjectContextBar, placeContextRow } from "./map-project-context-bar";
import { MapProjectTopBar } from "./map-project-top-bar";
import { MapProjectModeSwitches } from "./map-project-mode-switches";
import { stepGap, useMapProjectModes } from "./use-map-project-modes";
import { useMapProjectFlick } from "./use-map-project-flick";
import { useMapProjectSnap } from "./use-map-project-snap";
import { useMapProjectDrawAssist } from "./use-map-project-draw-assist";
import { useMapProjectUnfilled } from "./use-map-project-unfilled";
import { useMapProjectWalk } from "./use-map-project-walk";
import { draftExtra, nearestAnchor, objectExtra, type SnapExtra } from "../../lib/map-project-snap";
import { MapProjectToolRail } from "./map-project-tool-rail";
import { HelpButton } from "../help/help-panel";
import { MapProjectKeysDialog, useMapProjectKeys } from "./map-project-keys-dialog";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { keyLabel } from "../../lib/map-project-keys";
import { editPointAt } from "../../lib/map-project-point-edit";
import { anchorOf, ROTATE_CURSOR, useMapProjectMulti } from "./use-map-project-multi";
import { useMapProjectShortcuts } from "./use-map-project-shortcuts";
import { useMapProjectCollaboration } from "./use-map-project-collaboration";
import { useMapProjectEditor } from "./use-map-project-editor";
import { MapProjectToolWheel } from "./map-project-tool-wheel";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { circleFor } from "../../lib/map-project-shape-actions";
import { useMapProjectRecent } from "./use-map-project-recent";
import { MapProjectPrintButton } from "./map-project-print-button";
import { MapProjectObjectBar } from "./map-project-object-bar";
import { useMapProjectText } from "./use-map-project-text";
import { MapProjectTextLayer, placeTextField } from "./map-project-text";
import styles from "./map-project-editor.module.css";

/** `area` = rita ett delområde (bara ägarna); `split` = dela kartområdet eller en del med ett streck; `note` = tryck där en notis ska sitta (K3); `circle` = runda former (ägaren 2026-11-09); `bucket` = Fyll yta (rutan mellan linjerna, ägaren 2026-11-13). */
type Tool = "select" | "draw" | "area" | "split" | "note" | "circle" | "rectangle" | "bucket" | "text" | "addPoint" | "removePoint" | "cut";
interface Selected { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }
type Drag =
  /** `extra`: objektets övriga punkter och sträckor att fästa mot (K8b V3); `anchor`: objektets punkt närmast greppet, som fästs. */
  | { readonly mode: "vertex"; readonly address: VertexAddress; readonly original: MapObject; readonly extra: SnapExtra }
  | { readonly mode: "object"; readonly start: Point; readonly original: MapObject; readonly anchor: Point | undefined }
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
/** Fingret: så länge (ms) innan något markerat följer med i ett drag. Kort (ägaren 2026-11-12: «lyckas bara en gång»): efter 550 ms öppnas hjulet, så fönstret var för smalt med 250. */
const TOUCH_HOLD_MS = 120;
const degreesTo = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
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
  const georeference = editor.georeference;
  // K4a: egna underlag (ritas först, under allt annat ovanpå kartan).
  // Bilderna väntar tills den första synken är klar (eller inte gick), så att kartans objekt kommer först (ägaren 2026-11-14).
  const layers = useMapProjectLayers(view, georeference ?? undefined, editor.sync.at !== undefined || editor.mapStatus === "failed");
  const control = useMapProjectControlPoints(layers);
  const drawnLayers = control.drawn;
  // Normkontrollen (av från början).
  const norm = useMapProjectNorm(session, editor.renderKey);
  const [shownIssue, setShownIssue] = useState<Point>();
  const normIssues = norm.result?.issues;
  // K3: linjen som gås med GPS (`use-map-project-walk.ts`).
  const { walk, onFix, ...walking } = useMapProjectWalk(georeference, recon.onFix);
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
  /** Det pekaren står på i hjulet (raden under kartan). */
  const [wheelHover, setWheelHover] = useState<string>();
  // Ägaren 2026-11-10: panelens flik, och bara kartan (verktygsspalten och panelen gömda) med knappen överst eller §.
  // Översynen av första kartan (K1): en ny karta utan objekt börjar i Grundkarta, en karta med innehåll i Symboler.
  const [tab, setTab] = useState<SidebarTab>(() => view.base.source === "NEW" && view.changedObjects === 0 ? "basemap" : "symbols");
  // Ägaren 2026-11-19: släckta underlag hämtas först när fliken Grundkarta syns (reglagen läser dem); i telefonbredd är panelen stängd från början.
  const { loadHidden } = layers;
  useEffect(() => { if (tab === "basemap" && (panelOpen || !window.matchMedia("(max-width: 760px)").matches)) loadHidden(); }, [tab, panelOpen, loadHidden]);
  const [bare, setBare] = useState(false);
  // Ägaren 2026-11-10: tangenterna under vänster hand, valbara (sparade i webbläsaren).
  const [keys, setKeys] = useMapProjectKeys();
  const [keysOpen, setKeysOpen] = useState(false);
  const keysText = useTexts(mapProjectKeysSv, mapProjectKeysEn);
  const keyOf = (command: keyof typeof keys) => keys[command] ? keyLabel(keys[command], keysText.space) : undefined;
  const drawingArea = !!newArea;
  useEffect(() => { if (drawingArea) setTab("review"); }, [drawingArea]);
  const [circleCenter, setCircleCenter] = useState<Point>();
  const [flash, setFlash] = useState<string>();
  const split = useMapProjectSplit({ view, areas: collab.areas, bounds: editor.bounds ?? undefined, only: shownArea, reload: collab.loadAreas, say: setFlash, done: () => setTool("select") });
  const mapArea = useRef<HTMLDivElement>(null);
  const contextRow = useRef<HTMLDivElement>(null);
  /** Hjulets platser (sätts längre ned): snärten väljer verktyget på platsen i riktningen. */
  const wheelSlots = useRef<readonly ({ readonly disabled?: boolean | undefined; readonly onPick: () => void } | undefined)[]>([]);
  const wheelGate = useMapProjectFlick(mapArea, slot => { const target = wheelSlots.current[slot]; if (target && !target.disabled) target.onPick(); });
  const pointerAt = useRef<{ x: number; y: number }>(undefined);
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(undefined), 5000); return () => clearTimeout(timer); }, [flash]);

  selectedRef.current = selected;
  const symbols = useMemo(() => new Map(catalog.map(symbol => [symbol.id, symbol])), [catalog]);
  const { recent, remember: rememberRecent, shown: recentSymbols } = useMapProjectRecent(view.projectId, symbols);
  // K4b: kandidaterna ur en vektorfil (visas som förslag tills de lämnats).
  const importer = useMapProjectImport(view, georeference ?? undefined, editor.bounds ?? undefined, symbols,
    useCallback(() => { void loadProposals(); }, [loadProposals]), session, editor.commitMany);
  // K6: generaliseringen som förslag.
  const generalizer = useMapProjectGeneralize(view, session, editor.state, useCallback(() => { void loadProposals(); }, [loadProposals]));
  const rectify = useMapProjectRectify(view, session, editor.state, useCallback(() => { void loadProposals(); }, [loadProposals]),
    georeference ?? undefined, symbols, editor.commitMany);
  // Grundkartan G2b: kandidaterna ritas av Workern med sina symboler ovanpå kartan.
  const candidates = importer.candidates, showCandidates = editor.showCandidates; useEffect(() => { showCandidates(candidates); }, [candidates, showCandidates]);
  // Ägaren 2026-11-18: medan utkastet visas tonas kartan och underlagen släcks (kandidaterna ritas i full färg ovanpå).
  const focused = importer.focus && candidates.length > 0;
  const allSymbols = useMemo(() => [...symbols.keys()], [symbols]);
  const symbol = symbolId ? symbols.get(symbolId) : undefined;
  // Ägaren 2026-11-09: lagren efter normen. Släckta och låsta lager går inte att markera; låsta kan visas nedtonade.
  const work = useMapProjectWorkLayers(view);
  const workGroups = useMemo(() => work.layers.filter(layer => layer.kind === "SYMBOLS").map(layer => ({ layerId: layer.layerId, codes: layer.codes })),
    [work.layers]);
  const symbolLayers = useMapProjectSymbolLayers({ projectId: view.projectId, catalog, scale: editor.scale ?? georeference?.scale, session,
    commitMany: editor.commitMany, work: workGroups });
  // Skisslagren som syns (och om de är tonade).
  const sketchLayers = useMemo(() => work.layers.filter(layer => layer.kind === "SKETCH" && !symbolLayers.state.work?.[layer.layerId]?.hidden)
    .map(layer => ({ color: layer.color, dimmed: symbolLayers.state.work?.[layer.layerId]?.dimmed === true,
      sketches: work.sketches.filter(sketch => sketch.layerId === layer.layerId) })), [work.layers, work.sketches, symbolLayers.state]);
  const hiddenSymbols = symbolLayers.hidden;
  const unselectable = useMemo(() => [...symbolLayers.hidden, ...symbolLayers.locked], [symbolLayers.hidden, symbolLayers.locked]);
  // Ägaren 2026-11-10: flera objekt markerade med en ruta (som i Illustrator). Mellanslag nedtryckt = dra kartan i stället.
  const multi = useMapProjectMulti({ session, hidden: unselectable, commit, setPreviewKeys: setPreview, tool });
  const panKey = useRef({ down: false, used: false });
  // K8b V1: Fäst (V3) och Glapp, som Magisk fyll läser (V2).
  const modes = useMapProjectModes({ projectId: view.projectId, sprint: useMemo(() => isSprintNorm(mapNorm({ scale: editor.scale ?? georeference?.scale, symbols: symbols.values() })),
    [editor.scale, georeference?.scale, symbols]) });
  const fill = useMapProjectFill({ session, active: tool === "bucket" && canEdit, symbol, hidden: hiddenSymbols, commit, say: setFlash, symbols, scale: editor.scale ?? georeference?.scale, commitMany: editor.commitMany, gapM: modes.gapM,
    select: hit => { setSelected({ key: hit.key, ref: hit.ref, object: hit.object }); setActiveVertex(undefined); }, switchKey: keyOf("switchSymbol") });
  // K8b V3: Fäst mot synliga objekt (också låsta) i Rita, Rektangel, Cirkelns mitt, Lägg till punkt och när punkter dras.
  const snap = useMapProjectSnap({ session, renderKey: editor.renderKey, on: modes.snap && canEdit, hidden: hiddenSymbols, tool });
  const snapping = canEdit && (tool === "draw" || tool === "rectangle" || tool === "addPoint" || (tool === "circle" && !circleCenter));
  const snapExtra = () => ({ extra: draftExtra(tool === "draw" ? draft.map(entry => entry.at) : tool === "rectangle" ? rectCorners.current : []) });
  // K8b V5: följ kant (Skift) och vinkellås (⌘/Ctrl) i Rita, och Visa ofyllda rutor (⇧§).
  const assist = useMapProjectDrawAssist({ snap, tool, points: draft.map(entry => entry.at), corners: () => rectCorners.current, setCursor });
  const unfilled = useMapProjectUnfilled({ session, renderKey: editor.renderKey, hidden: hiddenSymbols, area: view.area ?? undefined, scale: editor.scale ?? georeference?.scale,
    focus: point => mapHandle.current?.focus(point) });
  useEffect(() => { if (selected && symbolLayers.locked.has(selected.object.symbol)) deselect(); }, [symbolLayers.locked, selected]);
  const deselect = () => { setSelected(undefined); setActiveVertex(undefined); setRotating(false); setMoveWhole(false); };
  const cancelDraft = () => { setDraft([]); setPreviewObject(undefined); setCircleCenter(undefined); };
  const startSplit = (only?: string | null) => { deselect(); cancelDraft(); setNewArea(undefined); if (only !== undefined) setShownArea(only ?? undefined); setTool("split"); setPanelOpen(false); };

  const save = useCallback((key: ObjectKey, ref: ObjectRef | null, object: MapObject | undefined, kind: EditKind, point?: Point): boolean => {
    const ok = commit({ key, ref, kind, after: object ? { kind: "OBJECT", object } : { kind: "DELETED" }, point });
    if (ok && object) setSelected({ key, ref, object });
    if (ok && !object) deselect();
    return ok;
  }, [commit]);

  /** Ett nytt objekt (ett ångringsbart ADD), om det finns något. */
  const addNew = (object: MapObject | undefined) => { if (object) save(newKey(crypto.randomUUID()), null, object, "ADD"); };
  const finishDraft = useCallback(() => {
    if (tool === "area" || tool === "split") {
      const ring = draft.map(point => point.at);
      cancelDraft();
      if (tool === "split") void split.split(ring); else if (ring.length >= 3) { setNewArea(ring); setPanelOpen(true); }
      return;
    }
    if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) return;
    const object = draftObject(symbol.kind, symbol.id, draft);
    cancelDraft();
    if (object) save(newKey(crypto.randomUUID()), null, object, "ADD");
  }, [draft, symbol, save, tool, split]);

  const removeSelected = useCallback(() => {
    if (!selected || !canEdit) return;
    if (activeVertex && selected.object.kind !== "point" && selected.object.kind !== "text") {
      const next = deleteVertex(selected.object, activeVertex);
      if (next) { save(selected.key, selected.ref, next, "RESHAPE"); setActiveVertex(undefined); return; }
    }
    save(selected.key, selected.ref, undefined, "DELETE", anchorOf(selected.object));
  }, [selected, activeVertex, canEdit, save]);

  // K8b V6: textverktyget och textsymbolerna (`use-map-project-text.ts`).
  const textUi = useMapProjectText({ view, canEdit, catalog, symbols, symbol, recent, chooseSymbol: id => { setSymbolId(id); rememberRecent(id); }, save, say: setFlash, show: editor.showTextSymbols,
    objects: { undo: editor.history.undo.length, redo: editor.history.redo.length }, undo: editor.undo, redo: editor.redo });
  const textField = useRef<HTMLTextAreaElement>(null);
  // Hjulet vid pekaren, eller mitt på kartan när pekaren inte har varit där (knappen i verktygsspalten).
  const openWheel = () => {
    const rect = mapArea.current?.getBoundingClientRect();
    if (canEdit && rect) setWheel({ screen: pointerAt.current ?? { x: rect.width / 2, y: rect.height / 2 }, bounds: { width: rect.width, height: rect.height } });
  };
  // Tangenterna (`use-map-project-shortcuts.ts`).
  const rectCorners = useRef<Point[]>([]);
  // K8b V1: det som går att göra med det markerade (kontextraden, hjulets lista, tangenterna och Gör igen).
  const { contextList, doAction, keyAction, repeat, repeatLabel } = useMapProjectActions({ canEdit, tool, keys, keysText, quick, multi, selected, symbol, symbolId,
    activeVertex, recon, symbols, catalog, save, reshape, commit, setFlash, chooseSymbol, removeSelected, joinMm: JOIN_MM,
    text: { labels: textUi.labels, edit: () => { if (selected?.object.kind === "text") textUi.edit({ ...selected, object: selected.object }); }, rotate: () => setRotating(true), style: () => textUi.styles.setOpen(selected?.object.symbol) } });
  useMapProjectShortcuts({ keys, blocked: keysOpen, canEdit, canNote: notes.canWrite, tool, hasSelection: !!selected, drafting: draft.length > 0,
    multiCount: multi.items.length, panKey, undo: textUi.undo, redo: textUi.redo, toggleBare: () => setBare(value => !value),
    pickTool: next => { if (next === "text" && !textUi.start()) return; if (next === "draw" || next === "circle" || next === "text") deselect(); cancelDraft(); setTool(next); },
    restoreTool: previous => { cancelDraft(); setTool(previous as Tool); },
    selectedAction: keyAction, layerKey: symbolLayers.groupKey, repeat,
    toggleUnfilled: unfilled.toggle, toggleSnap: () => { modes.setSnap(!modes.snap); setFlash(keysText.snapChanged(!modes.snap)); },
    gapStep: direction => { const next = stepGap(modes.gapM, direction); modes.setGapM(next); setFlash(keysText.gapChanged(next)); },
    recentKey: digit => { const chosen = symbols.get(recent[digit - 1] ?? ""); if (chosen) { setSymbolId(chosen.id); setFlash(keysText.picked(chosen.code)); } },
    openWheel,
    // Esc avbryter det pågående; en gång till (inget pågår) ger Markera.
    escape: () => { if (fill.escape()) return; if (draft.length || circleCenter || rectCorners.current.length) { cancelDraft(); rectCorners.current.length = 0; }
      else if (selected || multi.items.length) { deselect(); multi.clear(); } else if (tool !== "select") setTool("select"); }, finishDraft,
    dropDraftPoint: () => setDraft(points => points.slice(0, -1)), remove: () => { if (multi.items.length) multi.remove(); else removeSelected(); } });

  function chooseSymbol(id: string) {
    setSymbolId(id);
    setPanelOpen(false);
    rememberRecent(id);
    if (canEdit && !selected && multi.items.length === 0 && tool !== "circle") { setTool(symbols.get(id)?.kind === "text" ? "text" : "draw"); cancelDraft(); }
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
    setCircleCenter(undefined); setPreviewObject(undefined); addNew(object);
  }

  const handlers: MapPointerHandlers = {
    unlifted: tool === "draw" || tool === "area" || tool === "split" || tool === "circle" || !!work.drawing,
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
      const step = snapping ? assist.step(point, modifiers, snapExtra().extra) : undefined, snapped = step?.hit, at = step?.at ?? point;
      if (tool === "area" || tool === "split") {
        const first = draft[0];
        if (double || (tool === "area" && first && draft.length >= 3 && Math.hypot(first.at.x - point.x, first.at.y - point.y) <= tolerance)) { finishDraft(); return; }
        setDraft(points => [...points, { at: point }]);
        return;
      }
      if (tool === "bucket" && canEdit) { fill.tap(point, modifiers.alt, modifiers); return; }
      if (tool === "text" && canEdit) { textUi.place(point); return; }
      if (tool === "circle" && canEdit) {
        if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) { setFlash(quick.circleNeedsShape); return; }
        if (circleCenter) placeCircle(circleCenter, point); else setCircleCenter(at);
        return;
      }
      if (tool === "draw" && canEdit) {
        if (!symbol) return;
        if (symbol.kind === "point") { save(newKey(crypto.randomUUID()), null, { kind: "point", symbol: symbol.id, at, angle: 0 }, "ADD"); return; }
        if (symbol.kind === "text") { textUi.place(point); return; }
        if (double) { finishDraft(); return; }
        const first = draft[0];
        if (symbol.kind === "area" && first && draft.length >= 3 && Math.hypot(first.at.x - at.x, first.at.y - at.y) <= tolerance) { finishDraft(); return; }
        setDraft(points => [...points, ...(step?.via ?? []).map(via => ({ at: via })), { at }]); assist.remember(at, snapped);
        return;
      }
      // Skift+klick lägger till eller tar bort ett objekt i markeringen; ett vanligt klick släpper den.
      if (tool === "select" && modifiers.free && canEdit) {
        session?.hit(point, tolerance, unselectable, hits => { if (hits[0]) { multi.toggle(hits[0], selected); deselect(); } });
        return;
      }
      multi.clear();
      // Saxen, Lägg till punkt, Ta bort punkt och Cmd/Ctrl+klick i Redigera (`map-project-click-tools.ts`).
      if (canEdit && clickTool({ tool, command: modifiers.command, point: tool === "rectangle" ? at : point, snapped, tolerance, selected, session, hidden: unselectable, commit, save, text: keysText, setFlash,
        rectangle: { corners: rectCorners.current, symbol }, onCut: multi.showCut,
        onEdited: (target, address) => { setSelected(target); setActiveVertex(address); setRotating(false); } })) return;
      // Redigera: dubbelklick på en punkt tar bort den, på en sträcka (rak eller kurva) ger det en ny punkt; annars markera (klick
      // igen på samma ställe tar nästa objekt under).
      if (double && selected?.object.kind === "text" && canEdit && tool === "select") { textUi.edit({ ...selected, object: selected.object }); return; }
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
    onDragStart(point, tolerance, pointerType, pxPerMm, heldMs) {
      if (control.active || rectify.picking) return false;
      if (tool === "bucket") return /* K8b V4: dragningen samlar rutor */ canEdit && !panKey.current.down && fill.dragStart(point, pointerType);
      // Ägaren 2026-11-10: med fingret följer något markerat med först efter ett kort håll; ett snabbt drag flyttar kartan.
      const quickTouch = pointerType === "touch" && heldMs < TOUCH_HOLD_MS;
      if (work.drawing) return work.dragStart(point);
      if (!canEdit || tool === "area" || tool === "split" || tool === "text") return false;
      if (tool === "circle") {
        if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) return false;
        drag.current = { mode: "circle", center: circleCenter ?? snap.at(point, { pointerType, pxPerMm }) };
        return true;
      }
      if (tool === "draw") {
        if (!symbol || symbol.kind === "text") return false;
        const hit = snap.hit(point, { pointerType, pxPerMm }, snapExtra()), at = hit?.at ?? point;
        assist.remember(at, hit);
        if (symbol.kind === "point") { drag.current = { mode: "place", at }; setPreviewObject({ kind: "point", symbol: symbol.id, at, angle: 0 }); return true; }
        drag.current = { mode: "handle" };
        setDraft(points => [...points, { at, handle: { x: 0, y: 0 } }]);
        return true;
      }
      if (tool === "select" && multi.items.length && !quickTouch && multi.grab(point, tolerance)) return true;
      // Ett drag på tom karta med musen ritar en ruta som markerar; med mellanslag nedtryckt (och med fingret) flyttas kartan.
      const marquee = () => {
        if (tool !== "select" || pointerType === "touch" || panKey.current.down) { panKey.current.used = true; return false; }
        deselect(); multi.startMarquee(point);
        return true;
      };
      if (!selected) return marquee();
      if (quickTouch && tool === "select") return marquee();
      // Fingret är trubbigt (ägaren 2026-11-12: «för liten tolerans?»): det markerade objektet tas med större träffyta.
      const object = selected.object, reach = pointerType === "touch" ? tolerance * 1.7 : tolerance;
      if (rotating && (object.kind === "point" || object.kind === "text")) { drag.current = { mode: "rotate", original: object }; setPreview(new Set([selected.key])); return true; }
      if (object.kind !== "point" && object.kind !== "text") {
        // Den aktiva punktens styrpunkter först (de ligger ofta nära punkten).
        const handles = activeVertex ? vertexHandles(object, activeVertex) : undefined;
        for (const which of ["in", "out"] as const) {
          const handle = handles?.[which];
          if (activeVertex && handle && Math.hypot(handle.x - point.x, handle.y - point.y) <= reach) {
            drag.current = { mode: "curveHandle", address: activeVertex, which, original: object };
            setPreview(new Set([selected.key]));
            return true;
          }
        }
        const vertex = nearestVertex(object, point, reach);
        if (vertex) {
          drag.current = { mode: "vertex", address: { part: vertex.part, index: vertex.index }, original: object, extra: objectExtra(object, vertex.at) };
          setActiveVertex({ part: vertex.part, index: vertex.index });
          setPreview(new Set([selected.key]));
          return true;
        }
      }
      // En sträcka böjs där man tar tag (en linje dras hel med "Flytta hela"; en yta dras hel inifrån).
      const segmentHit = moveWhole ? undefined : nearestSegment(object, point, reach);
      if (segmentHit) {
        drag.current = { mode: "bend", address: segmentHit, t: segmentHit.t, start: segmentHit.at, original: object };
        setPreview(new Set([selected.key]));
        return true;
      }
      if (hitDistance(object, point, reach)) {
        drag.current = { mode: "object", start: point, original: object, anchor: nearestAnchor(object, point) };
        setPreview(new Set([selected.key]));
        return true;
      }
      return marquee();
    },
    onDragMove(point, modifiers) {
      if (fill.dragging()) { fill.dragMove(point, modifiers.free); return; } if (work.dragging) { work.dragMove(point); return; }
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
      const exclude = selectedRef.current?.key;
      if (current.mode === "vertex") setPreviewObject(moveVertex(current.original, current.address, snap.at(point, modifiers, { exclude, extra: current.extra })));
      else if (current.mode === "object") {
        const { anchor, start } = current, d = { x: point.x - start.x, y: point.y - start.y };
        const to = anchor ? snap.at({ x: anchor.x + d.x, y: anchor.y + d.y }, modifiers, { exclude }) : undefined;
        setPreviewObject(translateObject(current.original, to && anchor ? { x: to.x - anchor.x, y: to.y - anchor.y } : d));
      }
      else if (current.original.kind === "point" || current.original.kind === "text") setPreviewObject(rotatePoint(current.original, degreesTo(current.original.at, point)));
    },
    onDragEnd() {
      if (fill.dragging()) { fill.dragEnd(); return; } if (work.dragging) { work.dragEnd(); return; }
      if (multi.dragging()) { multi.dragEnd(); return; }
      const current = drag.current;
      drag.current = undefined;
      const moved = previewRef.current;
      const target = selectedRef.current;
      setPreviewObject(undefined);
      setPreview(new Set()); snap.clear();
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
    onDragCancel() { if (fill.dragging()) fill.escape(); multi.cancel(); drag.current = undefined; setPreviewObject(undefined); setPreview(new Set()); snap.clear(); },
    onHover(point, modifiers) {
      if (tool === "select" && multi.items.length) multi.hover(point, 8 / modifiers.pxPerMm);
      if (tool === "bucket") fill.hover(point, modifiers.alt);
      const at = point && snapping ? assist.hover(point, modifiers, snapExtra().extra) : point;
      if (!snapping || !point) { snap.clear(); assist.leave(); }
      if (tool !== "select" && (draft.length || circleCenter)) setCursor(at);
      if (tool === "circle" && circleCenter && point && symbol) setPreviewObject(circleFor(symbol.kind, symbol.id, circleCenter, point));
    },
    // Ägaren 2026-11-09: högerklick avslutar det som ritas (som i Mapper), annars öppnas verktygshjulet. Ett objekt under
    // pekaren markeras först, så att hjulets åtgärder gäller det.
    onContextMenu(point, screen, tolerance) {
      if (!canEdit) return;
      if (draft.length) { finishDraft(); return; }
      const rect = mapArea.current?.getBoundingClientRect();
      // K8b V1: med högerknappen nere avgör snärten om hjulet öppnas (`use-map-project-flick.ts`).
      const open = () => wheelGate(() => setWheel({ screen, bounds: { width: rect?.width ?? 800, height: rect?.height ?? 600 } }));
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

  const contextKey = contextList.map(action => action.label).join("|");
  const reconResult = recon.result;
  const coverage = useMemo(() => reconResult?.coverage && recon.layers.has("COVERAGE")
    ? { grid: reconResult.coverage, image: coverageImage(reconResult.coverage) } : undefined, [reconResult, recon.layers]);
  const gapMm = editor.georeference ? MAX_SEGMENT_M / metersPerMm(editor.georeference, editor.georeference.scale) : Infinity;
  const overlay = useCallback((ctx: CanvasRenderingContext2D, current: Viewport) => {
    const shown = preview ?? selected?.object;
    if (!focused) drawLayers(ctx, current, drawnLayers);
    if (coverage?.image) drawCoverage(ctx, current, coverage.grid, coverage.image);
    if (recon.layers.has("TRACKS")) drawTracks(ctx, current, recon.trackLines.others, recon.trackLines.recording, gapMm);
    if (walk && walk.length > 0) drawTracks(ctx, current, [], walk.map(point => ({ ...point, accuracyM: 0 })), Infinity);
    if (view.area) drawMapArea(ctx, current, view.area);
    drawAreas(ctx, current, areaDrawings);
    drawProposed(ctx, current, proposedOpen.objects, proposedOpen.deleted, false);
    drawProposed(ctx, current, proposedShown.objects, proposedShown.deleted, true);
    if ((tool === "area" || tool === "split") && draft.length) {
      const ring = cursor ? [...draft.map(point => point.at), cursor] : draft.map(point => point.at);
      if (ring.length >= 2) drawAreas(ctx, current, [{ polygon: [ring], label: "", owner: "MINE", open: tool === "split" }]);
      drawDraftPoints(ctx, current, draft, cursor);
    }
    if (preview) drawPreview(ctx, current, preview, symbols.get(preview.symbol));
    if (tool === "circle" && circleCenter) drawDraftPoints(ctx, current, [{ at: circleCenter }], cursor);
    if (tool === "draw" && symbol && draft.length) {
      const tentative = cursor ? [...draft, ...assist.via.map(at => ({ at })), { at: cursor }] : draft;
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
    if (multi.box && multi.items.length) drawMultiSelection(ctx, current, multi.shown, multi.box, multi.cuts);
    if (multi.marquee) drawMarquee(ctx, current, multi.marquee);
    fill.draw(ctx, current); unfilled.draw(ctx, current);
    snap.draw(ctx, current); placeTextField(textField.current, textUi.draft, textUi.draftStyle, current);
    placeContextRow(contextRow.current, multi.items.length ? multi.box : shown && tool === "select" && selected ? objectBox(shown) : undefined, current, multi.items.length > 0);
    if (shown && tool === "select" && selected) {
      drawSelection(ctx, current, shown, activeVertex);
      const handles = activeVertex ? vertexHandles(shown, activeVertex) : undefined;
      if (handles) drawHandles(ctx, current, handles);
    }
  }, [preview, selected, symbols, tool, symbol, draft, cursor, circleCenter, activeVertex, areaDrawings, proposedOpen, proposedShown, view.area, coverage, recon.layers,
    recon.trackLines, reconResult, walk, gapMm, notes.notes, shownNote, noteDraft, drawnLayers, focused, candidates, normIssues, shownIssue,
    control.active, control.markers, rectify.shown, rectify.markers, sketchLayers, work.dragging, work.drawingLayer, work.stroke,
    multi.moving, multi.shown, multi.box, multi.cuts, multi.items.length, multi.marquee, fill.preview, fill.bridges, fill.gaps, fill.pending, fill.shown, fill.proposals.candidates, fill.proposals.override, contextKey, snap.mark, assist.via, unfilled.on, unfilled.result, editor.renderKey, hiddenSymbols, textUi.draft, textUi.draftStyle]);

  const hint = tool === "split" ? split.hint : tool === "bucket" && canEdit ? fill.hint : toolHint({ canEdit, closed: view.status === "CLOSED", tool, multiCount: multi.items.length, rotating: multi.zone === "rotate", symbol,
    text, notes: notesText, keys: keysText, quick, textHint: textUi.hint });
  const selectedSymbol = selected ? symbols.get(selected.object.symbol) : undefined, activeToolName = toolName(tool, quick, keysText);
  const hintLine = control.active ? (control.pending ? layersText.control.hintMap : layersText.control.hintImage)
    : rectify.picking ? (rectify.pending ? rectifyText.hintTo : rectifyText.hintFrom)
    : work.drawingLayer ? workText.hint(work.drawingLayer.name)
    // Ägaren 2026-11-15 («att det står längst ner vilken funktion i hjulet man använder»): det pekaren står på i hjulet, annars
    // det valda verktygets namn först på raden.
    : wheel && wheelHover ? wheelHover
    : flash ?? `${canEdit && activeToolName ? `${activeToolName} · ` : ""}${selectedSymbol && tool === "select" ? selectionLabel(selectedSymbol, selected?.object, editor.scale ?? georeference?.scale, keysText) : ""}${hint}`;
  const pickTool = (next: Tool) => () => { if (next !== "select") deselect(); cancelDraft(); rectCorners.current.length = 0; setTool(next); };
  // Saxen och punkterna som i spalten: det markerade släpps inte (man klipper ofta linjen man just markerat).
  const railPick = (next: "select" | "draw" | "circle" | "rectangle" | "bucket" | "text" | "addPoint" | "removePoint" | "cut" | "area" | "note") => {
    if (next === "text" && !textUi.start()) return;
    if (next === "select" || next === "addPoint" || next === "removePoint" || next === "cut") { cancelDraft(); setTool(next); }
    else if (next === "note") { cancelDraft(); setTool(tool === "note" ? "select" : "note"); } else pickTool(next)();
  };
  const pending = editor.state?.pending.length ?? 0;
  const conflicts = editor.state ? Object.values(editor.state.conflicts) : [];

  const wheelTools = wheelToolsOf({ keys, space: keysText.space, tool, canNote: notes.canWrite, labels: quick.tools, repeat: repeatLabel, onRepeat: repeat,
    help: { select: text.hints.select, rectangle: keysText.tips.rectangle, bucket: keysText.tips.bucket, cut: keysText.tips.cut, point: keysText.addPointHint, note: keysText.tips.note,
      repeat: keysText.tips.repeat },
    pick: next => railPick(next) });
  wheelSlots.current = wheelTools;
  const rail = railTools({ keys, text: keysText, tool, panelOpen, bare, canEdit, canDecide, canNote: notes.canWrite, unfilled: unfilled.on, toggleUnfilled: unfilled.toggle,
    labels: { panel: text.panel, select: text.tools.select, selectHelp: text.tools.selectHelp, draw: text.tools.draw, drawHelp: text.tools.drawHelp, circle: quick.tools.circle,
      area: text.collab.areaTool, note: notesText.tool, undo: text.tools.undo, redo: text.tools.redo },
    canUndo: textUi.canUndo, canRedo: textUi.canRedo, pick: railPick, undo: textUi.undo, redo: textUi.redo,
    togglePanel: () => setPanelOpen(open => !open), toggleBare: () => setBare(value => !value), openWheel, openKeys: () => setKeysOpen(true) });

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.title}>
        <Link className={styles.back} href={`/organizer/map-projects/${encodeURIComponent(view.projectId)}`} data-testid="map-project-back">
          <span aria-hidden="true">‹</span> <span className={styles.backText}>{text.back}</span></Link>
        <h1>{view.name}</h1>
      </div>
      <SyncBadge sync={editor.sync} pending={pending} />
      <button type="button" className={styles.bareToggle} aria-pressed={bare} title={keys.bare ? `${quick.bareHelp} (${keyLabel(keys.bare, keysText.space)})` : quick.bareHelp} data-testid="map-project-bare"
        onClick={() => setBare(value => !value)}>{bare ? quick.showPanels : quick.hidePanels}</button>
      <MapProjectPrintButton projectId={view.projectId} pending={pending} />
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
      {canEdit && <MapProjectTopBar recent={recentSymbols} symbolId={symbolId}
        onSymbol={setSymbolId} text={keysText} undo={{ label: text.tools.undo, key: keyOf("undo"), disabled: !textUi.canUndo, onPick: textUi.undo }}
        redo={{ label: text.tools.redo, key: keyOf("redo"), disabled: !textUi.canRedo, onPick: textUi.redo }} />}
      <div className={styles.mapArea} ref={mapArea} onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerAt.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      }}>
        {wheel && <MapProjectToolWheel at={wheel.screen} bounds={wheel.bounds} tools={wheelTools} onHover={setWheelHover}
          symbols={recentSymbols.slice(0, 6)}
          symbolId={symbolId} onSymbol={chooseSymbol} onClose={() => setWheel(undefined)}
          repeat={repeatLabel ? { id: "repeat", label: repeatLabel, key: keyOf("repeat"), onPick: repeat } : undefined}
          actions={[...contextList.map(action => ({ id: action.id, label: action.label, key: action.key, onPick: () => doAction(action.id) })),
            { id: "textTool", label: keysText.commands.text, key: keyOf("text"), onPick: () => railPick("text") }]} />}
        <MapProjectContextBar label={quick.actions} actions={contextList} rowRef={contextRow} onAction={doAction} spaceLabel={keysText.space} hidden={!!wheel} />
        <MapProjectTextLayer ui={textUi} fieldRef={textField} catalog={catalog} symbols={symbols} colors={editor.symbolColors.colors} fileIds={editor.symbolIds} chooseSymbol={chooseSymbol} />
        {editor.mapStatus === "loading" && <p className={styles.loading}>{text.loading}</p>}
        {editor.mapStatus === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
        {/* Kartvyn visas när kartan är läst: då har rutan sin storlek och hela kartan passas in. */}
        {editor.bounds && <div className={styles.frame}><CourseSettingMap session={session} mapBounds={editor.bounds} primitives={[]} faded={[]} marks={NO_MARKS} analysis={undefined}
          label={text.mapLabel} cursor={tool === "draw" || tool === "circle" || tool === "bucket" || tool === "rectangle" || tool === "addPoint" || tool === "removePoint" || tool === "cut" ? "crosshair" : "default"} handlers={handlers} overlayExtra={overlay}
          cursorAt={tool === "select" && multi.items.length ? (point, tolerance) => {
            const zone = multi.zoneAt(point, tolerance);
            return zone === "move" ? "move" : zone === "rotate" ? ROTATE_CURSOR : undefined;
          } : undefined}
          renderKey={editor.renderKey} hiddenSymbols={hiddenSymbols} dimmedSymbols={focused ? allSymbols : symbolLayers.dimmed} shownSymbols={symbolLayers.shown}
          position={position.position && positionMode !== "off" ? { position: position.position, follow: positionMode === "follow" } : undefined}
          onPan={() => setPositionMode(mode => mode === "follow" ? "on" : mode)} handle={mapHandle} /></div>}
        {editor.mapStatus === "ready" && georeference && <MapProjectFieldControls mode={positionMode} onMode={setPositionMode} problem={position.problem}
          aboveContext={contextList.length > 0 && !wheel} canRecord={recon.canRecord} recording={!!recon.recording}
          note={notes.canWrite && position.position ? () => { setShownNote(undefined); setNoteDraft({ at: position.position!.at }); } : undefined}
          onRecord={() => { if (recon.recording) void recon.stopRecording();
            else void recon.startRecording(reconText.recordDefault(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))); }}
          point={canEdit && symbol?.kind === "point" && position.position ? { code: symbol.code, onPlace: () => addNew({ kind: "point", symbol: symbol.id, at: position.position!.at, angle: 0 }) } : undefined}
          walk={canEdit && symbol?.kind === "line" && (position.position || walk) ? { code: symbol.code, walking: walk?.length,
            onStart: () => walking.start(position.position?.at),
            onStop: () => { const points = walking.stop(); addNew(points.length >= 2 ? draftObject("line", symbol.id, points.map(at => ({ at }))) : undefined); } } : undefined} />}
        {noteDraft && <NoteForm onCancel={() => setNoteDraft(undefined)} onSave={async (value, photo) => {
          await notes.create(noteDraft.at, value, photo, noteDraft.objectKey);
          setNoteDraft(undefined);
          if (tool === "note") setTool("select");
        }} />}
        {!noteDraft && shownNote && <ShownNoteDetail notes={notes} noteId={shownNote} onClose={() => setShownNote(undefined)} />}
      </div>
      <div className={styles.statusRow}>
        <MapProjectCandidateBar importer={importer} symbols={symbols} onShowLayers={() => { setTab("basemap"); setPanelOpen(true); }} />
        <MapProjectAreaProposalBar proposals={fill.proposals} />
        {/* Det som görs med det markerade står i kontextraden; här bara utkastet, skisslagret och flytta hela/vrid. */}
        {canEdit && <MapProjectObjectBar label={quick.actions} work={work} workText={workText} tools={text.tools} drafting={draft.length > 0} onFinish={finishDraft} onCancel={cancelDraft}
          selectedKind={selected && tool === "select" ? selected.object.kind : undefined} activeVertex={!!activeVertex} moveWhole={moveWhole} onMoveWhole={setMoveWhole}
          rotating={rotating} onRotating={setRotating} />}
        <p className={styles.hint} aria-live="polite" data-testid="map-project-hint" title={hintLine}>{hintLine}</p>
        {canEdit && <MapProjectModeSwitches snap={modes.snap} onSnap={() => modes.setSnap(value => !value)} snapKey={keyOf("snap")} snapState={snap.mark && keysText.snapAt(snap.mark.kind)}
          angle={assist.locked} unfilled={{ state: unfilled.state, onNext: unfilled.next }} gapM={modes.gapM} onGap={modes.setGapM} cells={fill.cells} text={keysText} />}
      </div>
      <MapProjectSidebar open={panelOpen} onClose={() => setPanelOpen(false)} catalog={catalog} symbolId={symbolId} onSymbol={chooseSymbol} tab={tab} onTab={setTab} onTextSymbol={textUi.styles.setOpen}
        recent={recentSymbols}
        standardSymbols={symbolLayers.standardSymbols} layerState={symbolLayers.state} conflicts={conflicts} symbols={symbols} onResolve={editor.resolve} canEdit={canEdit}
        layers={<>
          <MapProjectSymbolLayers catalog={catalog} standard={symbolLayers.standard} standardSymbols={symbolLayers.standardSymbols}
          state={symbolLayers.state} onState={symbolLayers.update} canEdit={canEdit} onMerge={symbolLayers.merge}
          merging={symbolLayers.merging} message={symbolLayers.message} work={workGroups} views={symbolLayers} symbolColors={editor.symbolColors}
          workPanel={<MapProjectWorkLayers work={work} catalog={catalog} state={symbolLayers.state} onState={symbolLayers.update} />} />
          {georeference && <MapProjectLayersPanel layers={layers} mapEpsg={georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined}
            control={control} scale={georeference.scale} area={editor.bounds ?? undefined} />}
          <MapProjectSettingsDetails>
            {georeference && <MapProjectNorthPanel georeference={georeference} northLines={editor.northLines} bounds={editor.bounds ?? undefined} importer={importer} symbols={symbols} />}
            <MapProjectColors colors={editor.colors} saved={editor.colorChanges} canChange={canDecide} ocad={view.base.format === "OCD"} onShow={editor.showColors} onSave={editor.saveColors} />
          </MapProjectSettingsDetails>
        </>}
        basemap={georeference ? <MapProjectBaseMapPanel view={view} georeference={georeference} bounds={editor.bounds ?? undefined} areas={collab.areas}
          layers={layers} importer={importer} symbols={symbols} work={work} onSplit={view.viewer.canDecide ? area => startSplit(area ?? null) : undefined}
          onAreas={() => { setTab("review"); setTimeout(() => document.getElementById("map-project-areas")?.scrollIntoView({ block: "start" }), 60); }}
          onDraw={() => setTab("symbols")} /> : undefined}
        review={<>
          {/* Översynen av kartstegen 2026-11-17: i arbetsordning – förslagen, normkontrollen, notiserna och rekningen, delområdena,
              och arbetssättet och AI-kopplingen (sällan ändrade) i en utfällning sist. */}
          {(["proposals", "norm", "notes", "recon", "areas", "settings"] as const).map(part => part === "norm"
            ? <MapProjectNormPanel key={part} norm={norm} onShow={issue => { setShownIssue(issue.at); setPanelOpen(false); mapHandle.current?.focus(issue.at); }} />
            : part === "notes" ? <NotesPanel key={part} notes={notes.notes} problem={notes.problem} onShow={note => { setShownNote(note.noteId); setPanelOpen(false); mapHandle.current?.focus(note.at); }} />
            : part === "recon" ? <MapProjectReconPanel key={part} view={view} recon={recon} hasGeoreference={!!georeference} />
            : <MapProjectCollabPanel key={part} part={part} view={view} collab={collab} shownProposal={shownProposal} onShowProposal={setShownProposal}
              shownArea={shownArea} onShowArea={setShownArea} newArea={!!newArea}
              onNewArea={() => { deselect(); cancelDraft(); setTool("area"); setPanelOpen(false); }}
              onSplitArea={() => startSplit()} splitting={tool === "split"}
              onSaveArea={(name, assignee) => { if (newArea) void collab.createArea(name, [newArea], assignee).then(ok => { if (ok) { setNewArea(undefined); setTool("select"); } }); }}
              onCancelArea={() => { setNewArea(undefined); setTool("select"); }} stages={stages} onStages={setStages} />)}
          <MapProjectToExport projectId={view.projectId} />
        </>}
        process={<>
          <MapProjectGeneralizePanel generalize={generalizer} areas={collab.areas} />
          {georeference && <MapProjectRectifyPanel rectify={rectify} areas={collab.areas} scale={georeference.scale} />}
        </>} />
    </div>
  </main>;
}

export type { CatalogSymbol };
