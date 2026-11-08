"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapObject, Point } from "@o-tid/map-file";
import {
  MAX_SEGMENT_M, bendSegment, deleteVertex, hitDistance, insertOnSegment, moveHandle, moveVertex, nearestSegment, newKey, vertexHandles, withSymbol,
  type EditKind, type ObjectKey, type ObjectRef, type VertexAddress
} from "@o-tid/map-revision";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { Viewport } from "../../lib/course-setting-viewport";
import { draftObject, nearestVertex, rotatePoint, translateObject, type DraftPoint } from "../../lib/map-project-draw";
import { drawAreas, drawDraftPoints, drawHandles, drawMapArea, drawPreview, drawProposed, drawSelection, type AreaDrawing } from "../../lib/map-project-overlay";
import { coverageImage, drawCoverage, drawNotes, drawReconMarkers, drawTracks, noteAt } from "../../lib/map-project-recon-overlay";
import { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import { NoteDetail, NoteForm, NotesPanel } from "./map-project-notes";
import { useMapProjectNotes } from "./use-map-project-notes";
import { metersPerMm, toMapPosition } from "../../lib/course-setting-geo";
import { mapProjectReconSv } from "../../i18n/map-project-recon-sv";
import type { CatalogSymbol, SymbolGroup } from "../../lib/map-project-protocol";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers } from "../course-setting/course-setting-map";
import { AccountMenu } from "../account-menu";
import { Button, Notice } from "../ui";
import { MapProjectCollabPanel } from "./map-project-collab-panel";
import { MapProjectFieldControls, type PositionMode } from "./map-project-field-controls";
import { MapProjectReconPanel } from "./map-project-recon-panel";
import { useMapProjectPosition, type TimedFix } from "./use-map-project-position";
import { useMapProjectRecon } from "./use-map-project-recon";
import { saveMapProjectShell } from "../../lib/map-project-offline";
import { MapProjectSidebar } from "./map-project-sidebar";
import { useMapProjectCollaboration } from "./use-map-project-collaboration";
import { useMapProjectEditor } from "./use-map-project-editor";
import styles from "./map-project-editor.module.css";

const text = mapProjectEditorSv;
/** `area` = rita ett delområde (bara ägarna); `note` = tryck där en notis ska sitta (K3). */
type Tool = "select" | "draw" | "area" | "note";
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
  | { readonly mode: "curveHandle"; readonly address: VertexAddress; readonly which: "in" | "out"; readonly original: MapObject };

const NO_MARKS = { selected: [], flagged: [], radiusMm: 0 } as const;
const SHOWN_STATUSES = new Set(["UNSEEN", "PASSED", "CHECKED"] as const);
const reconText = mapProjectReconSv;
const notesText = mapProjectNotesSv;
const DOUBLE_TAP_MS = 350;
const degreesTo = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
/** En punkt på objektet: var en borttagning ligger (för delområdena när servern bara har objektet i grundfilen). */
function anchorOf(object: MapObject): Point | undefined {
  if (object.kind === "point" || object.kind === "text") return object.at;
  const first = object.kind === "line" ? object.path[0] : object.rings[0]?.[0];
  return first ? { x: first.x, y: first.y } : undefined;
}
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
export function MapProjectEditor({ view, offlineSince }: { view: MapProjectView;
  /** K3: projektet kommer från telefonen (utan nät), sparat då. */
  offlineSince?: string | undefined }) {
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
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<SymbolGroup>>(new Set());
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

  selectedRef.current = selected;
  const symbols = useMemo(() => new Map(catalog.map(symbol => [symbol.id, symbol])), [catalog]);
  const symbol = symbolId ? symbols.get(symbolId) : undefined;
  const hiddenSymbols = useMemo(() => catalog.filter(entry => hiddenGroups.has(entry.group)).map(entry => entry.id), [catalog, hiddenGroups]);

  const deselect = () => { setSelected(undefined); setActiveVertex(undefined); setRotating(false); setMoveWhole(false); };
  const cancelDraft = () => { setDraft([]); setPreviewObject(undefined); };

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

  // Tangenterna (inte när man skriver i ett fält).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]"))) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); return; }
      if (command && key === "y") { event.preventDefault(); editor.redo(); return; }
      if (command) return;
      if (key === "e") { cancelDraft(); setTool("select"); }
      else if (key === "p" && canEdit) { deselect(); cancelDraft(); setTool("draw"); }
      else if (event.key === "Escape") { if (draft.length) cancelDraft(); else deselect(); }
      else if (event.key === "Enter" && draft.length) { event.preventDefault(); finishDraft(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && selected) { event.preventDefault(); removeSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, canEdit, draft, selected, finishDraft, removeSelected]);

  function chooseSymbol(id: string) {
    setSymbolId(id);
    setPanelOpen(false);
    if (canEdit && !selected) { setTool("draw"); cancelDraft(); }
  }

  const handlers: MapPointerHandlers = {
    unlifted: tool === "draw" || tool === "area",
    onTap(point, tolerance, modifiers) {
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
      // Redigera: dubbelklick på en punkt tar bort den, på en sträcka (rak eller kurva) ger det en ny punkt; annars markera (klick
      // igen på samma ställe tar nästa objekt under).
      if (double && selected && canEdit && selected.object.kind !== "point" && selected.object.kind !== "text") {
        const vertex = nearestVertex(selected.object, point, tolerance);
        if (vertex) {
          const removed = deleteVertex(selected.object, vertex);
          if (removed) { save(selected.key, selected.ref, removed, "RESHAPE"); setActiveVertex(undefined); }
          return;
        }
        const hit = nearestSegment(selected.object, point, tolerance);
        const inserted = hit ? insertOnSegment(selected.object, hit, hit.t) : undefined;
        if (inserted) { save(selected.key, selected.ref, inserted.object, "RESHAPE"); setActiveVertex(inserted.address); return; }
      }
      if (selected && selected.object.kind !== "point" && selected.object.kind !== "text") {
        const vertex = nearestVertex(selected.object, point, tolerance);
        if (vertex) { setActiveVertex({ part: vertex.part, index: vertex.index }); return; }
        // K3: ett klick på den markerade linjens kant behåller markeringen (dubbelklick för en ny punkt ska inte byta objekt);
        // objektet under nås med Alt-klick eller ett klick inne i en yta.
        if (!modifiers.alt && nearestSegment(selected.object, point, tolerance)) { setActiveVertex(undefined); return; }
      }
      session?.hit(point, tolerance, hiddenSymbols, hits => {
        if (hits.length === 0) { deselect(); return; }
        const at = selected ? hits.findIndex(hit => hit.key === selected.key) : -1;
        const next = hits[at >= 0 ? (at + 1) % hits.length : 0]!;
        setSelected({ key: next.key, ref: next.ref, object: next.object });
        setActiveVertex(undefined);
        setRotating(false);
      });
    },
    onDragStart(point, tolerance) {
      if (!canEdit || tool === "area") return false;
      if (tool === "draw") {
        if (!symbol || symbol.kind === "text") return false;
        if (symbol.kind === "point") { drag.current = { mode: "place", at: point }; setPreviewObject({ kind: "point", symbol: symbol.id, at: point, angle: 0 }); return true; }
        drag.current = { mode: "handle" };
        setDraft(points => [...points, { at: point, handle: { x: 0, y: 0 } }]);
        return true;
      }
      if (!selected) return false;
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
      return false;
    },
    onDragMove(point) {
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
      if (current.mode === "bend") { setPreviewObject(bendSegment(current.original, current.address, current.t,
        { x: point.x - current.start.x, y: point.y - current.start.y })); return; }
      if (current.mode === "curveHandle") { setPreviewObject(moveHandle(current.original, current.address, current.which, point)); return; }
      if (current.mode === "vertex") setPreviewObject(moveVertex(current.original, current.address, point));
      else if (current.mode === "object") setPreviewObject(translateObject(current.original, { x: point.x - current.start.x, y: point.y - current.start.y }));
      else if (current.original.kind === "point" || current.original.kind === "text") setPreviewObject(rotatePoint(current.original, degreesTo(current.original.at, point)));
    },
    onDragEnd() {
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
      if (!target || !moved) return;
      save(target.key, target.ref, moved, current.mode === "object" || current.mode === "rotate" ? "MOVE" : "RESHAPE");
    },
    onDragCancel() { drag.current = undefined; setPreviewObject(undefined); setPreview(new Set()); },
    onHover(point) { if (tool !== "select" && draft.length) setCursor(point); }
  };

  // Öppna förslag streckade (de egna direkt efter synken, andras ur listan); förslaget som visas heldraget.
  const proposedOpen = useMemo(() => proposedDrawing([
    ...Object.values(editor.state?.proposed ?? {}).filter(entry => entry.proposalId !== shownProposal),
    ...collab.proposals.filter(proposal => proposal.status === "OPEN" && proposal.proposalId !== shownProposal).flatMap(proposal => proposal.edits)
  ]), [editor.state?.proposed, collab.proposals, shownProposal]);
  const proposedShown = useMemo(() => proposedDrawing(collab.proposals.find(proposal => proposal.proposalId === shownProposal)?.edits ?? []),
    [collab.proposals, shownProposal]);
  const areaDrawings = useMemo((): AreaDrawing[] => [
    ...collab.areas.map(area => ({ polygon: area.polygon, label: area.name, selected: area.areaId === shownArea,
      owner: !area.assignee ? "NONE" as const : area.assignee.accountId === view.viewer.accountId ? "MINE" as const : "OTHER" as const })),
    ...(newArea ? [{ polygon: [newArea], label: "", owner: "MINE" as const, selected: true }] : [])
  ], [collab.areas, shownArea, newArea, view.viewer.accountId]);

  const reconResult = recon.result;
  const coverage = useMemo(() => reconResult?.coverage && recon.layers.has("COVERAGE")
    ? { grid: reconResult.coverage, image: coverageImage(reconResult.coverage) } : undefined, [reconResult, recon.layers]);
  const gapMm = editor.georeference ? MAX_SEGMENT_M / metersPerMm(editor.georeference, editor.georeference.scale) : Infinity;
  const overlay = useCallback((ctx: CanvasRenderingContext2D, current: Viewport) => {
    const shown = preview ?? selected?.object;
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
    if (tool === "draw" && symbol && draft.length) {
      const tentative = cursor ? [...draft, { at: cursor }] : draft;
      const object = symbol.kind === "line" || symbol.kind === "area" ? draftObject(symbol.kind, symbol.id, tentative) : undefined;
      if (object) drawPreview(ctx, current, object, symbol);
      drawDraftPoints(ctx, current, draft, cursor);
    }
    if (reconResult && recon.layers.has("STATUS")) drawReconMarkers(ctx, current, reconResult.markers, SHOWN_STATUSES);
    drawNotes(ctx, current, notes.notes, shownNote);
    if (noteDraft) drawNotes(ctx, current, [{ noteId: "", at: noteDraft.at, status: "OPEN", pending: true }], "");
    if (shown && tool === "select" && selected) {
      drawSelection(ctx, current, shown, activeVertex);
      const handles = activeVertex ? vertexHandles(shown, activeVertex) : undefined;
      if (handles) drawHandles(ctx, current, handles);
    }
  }, [preview, selected, symbols, tool, symbol, draft, cursor, activeVertex, areaDrawings, proposedOpen, proposedShown, view.area, coverage, recon.layers,
    recon.trackLines, reconResult, walk, gapMm, notes.notes, shownNote, noteDraft]);

  const hint = !canEdit ? (view.status === "CLOSED" ? text.closed : text.readOnly)
    : tool === "area" ? text.collab.areaHint
    : tool === "note" ? notesText.toolHint
    : tool === "select" ? text.hints.select
    : !symbol ? text.tools.noSymbol
    : symbol.kind === "point" ? text.hints.drawPoint(symbol.code)
    : symbol.kind === "line" ? text.hints.drawLine(symbol.code)
    : symbol.kind === "area" ? text.hints.drawArea(symbol.code) : text.tools.textNotSupported;
  const selectedSymbol = selected ? symbols.get(selected.object.symbol) : undefined;
  const hintLine = `${selectedSymbol && tool === "select" ? `${selectedSymbol.code} ${selectedSymbol.name} · ` : ""}${hint}`;
  const canSwitch = !!selected && !!symbol && symbol.id !== selected.object.symbol && symbol.kind === selected.object.kind && canEdit;
  const pending = editor.state?.pending.length ?? 0;
  const conflicts = editor.state ? Object.values(editor.state.conflicts) : [];

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.title}>
        <Link href={`/organizer/map-projects/${encodeURIComponent(view.projectId)}`}>{text.back}</Link>
        <h1>{view.name}</h1>
      </div>
      <SyncBadge sync={editor.sync} pending={pending} />
      <AccountMenu />
    </header>
    {offlineSince && <p className={styles.offline} role="status" data-testid="map-project-offline">
      {text.offline(new Date(offlineSince).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</p>}
    {editor.notice && <div className={styles.notice}><Notice tone="attention" role="status">{noticeText(editor.notice)}{" "}
      <Button variant="quiet" onClick={() => editor.setNotice(undefined)}>{text.ok}</Button></Notice></div>}
    <div className={styles.workspace}>
      <div className={styles.toolbar} role="toolbar" aria-label={text.tools.label}>
        <Button variant={panelOpen ? "primary" : "secondary"} className={styles.panelToggle} aria-pressed={panelOpen} aria-controls="map-project-sidebar"
          onClick={() => setPanelOpen(open => !open)}>{text.panel}</Button>
        {canEdit && <>
        <Button variant={tool === "select" ? "primary" : "secondary"} aria-pressed={tool === "select"} title={text.tools.selectHelp}
          onClick={() => { cancelDraft(); setTool("select"); }}>{text.tools.select}</Button>
        <Button variant={tool === "draw" ? "primary" : "secondary"} aria-pressed={tool === "draw"} title={text.tools.drawHelp}
          onClick={() => { deselect(); cancelDraft(); setTool("draw"); }}>{text.tools.draw}</Button>
        {canDecide && <Button variant={tool === "area" ? "primary" : "secondary"} aria-pressed={tool === "area"}
          onClick={() => { deselect(); cancelDraft(); setTool("area"); }}>{text.collab.areaTool}</Button>}
        {notes.canWrite && <Button variant={tool === "note" ? "primary" : "secondary"} aria-pressed={tool === "note"} data-testid="map-project-note-tool"
          onClick={() => { cancelDraft(); setTool(tool === "note" ? "select" : "note"); }}>{notesText.tool}</Button>}
        <Button variant="secondary" disabled={editor.history.undo.length === 0} onClick={editor.undo} title="Ctrl/Cmd+Z">{text.tools.undo}</Button>
        <Button variant="secondary" disabled={editor.history.redo.length === 0} onClick={editor.redo} title="Ctrl/Cmd+Skift+Z">{text.tools.redo}</Button>
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
          {canSwitch && <Button variant="secondary" onClick={() => save(selected.key, selected.ref, withSymbol(selected.object, symbol.id), "SYMBOL")}>
            {text.tools.switchSymbol(symbol.code)}</Button>}
          {recon.canRecord && <Button variant={recon.validChecks.has(selected.key) ? "primary" : "secondary"} aria-pressed={recon.validChecks.has(selected.key)}
            data-testid="recon-check" title={recon.validChecks.has(selected.key) ? reconText.checkedBy(recon.checks.get(selected.key)?.name ?? null,
              new Date(recon.checks.get(selected.key)?.at ?? Date.now()).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })) : undefined}
            onClick={() => void recon.setChecked([selected.key], !recon.validChecks.has(selected.key))}>
            {recon.validChecks.has(selected.key) ? reconText.checked : reconText.unchecked}</Button>}
        </>}
        </>}
      </div>
      <p className={styles.hint} aria-live="polite" data-testid="map-project-hint" title={hintLine}>{hintLine}</p>
      <div className={styles.mapArea}>
        {editor.mapStatus === "loading" && <p className={styles.loading}>{text.loading}</p>}
        {editor.mapStatus === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
        {/* Kartvyn visas när kartan är läst: då har rutan sin storlek och hela kartan passas in. */}
        {editor.bounds && <div className={styles.frame}><CourseSettingMap session={session} mapBounds={editor.bounds} primitives={[]} faded={[]} marks={NO_MARKS} analysis={undefined}
          label={text.mapLabel} cursor={tool === "draw" ? "crosshair" : "default"} handlers={handlers} overlayExtra={overlay}
          renderKey={editor.renderKey} hiddenSymbols={hiddenSymbols}
          position={position.position && positionMode !== "off" ? { position: position.position, follow: positionMode === "follow" } : undefined}
          onPan={() => setPositionMode(mode => mode === "follow" ? "on" : mode)} handle={mapHandle} /></div>}
        {editor.mapStatus === "ready" && georeference && <MapProjectFieldControls mode={positionMode} onMode={setPositionMode} problem={position.problem}
          canRecord={recon.canRecord} recording={!!recon.recording}
          note={notes.canWrite && position.position ? () => { setShownNote(undefined); setNoteDraft({ at: position.position!.at }); } : undefined}
          onRecord={() => { if (recon.recording) void recon.stopRecording();
            else void recon.startRecording(reconText.recordDefault(new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }))); }}
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
      <MapProjectSidebar open={panelOpen} catalog={catalog} symbolId={symbolId} onSymbol={chooseSymbol} hiddenGroups={hiddenGroups}
        onToggleGroup={group => setHiddenGroups(current => {
          const next = new Set(current);
          if (next.has(group)) next.delete(group); else next.add(group);
          return next;
        })} conflicts={conflicts} symbols={symbols} onResolve={editor.resolve} canEdit={canEdit}
        after={<>
          <NotesPanel notes={notes.notes} problem={notes.problem} onShow={note => { setShownNote(note.noteId); setPanelOpen(false); mapHandle.current?.focus(note.at); }} />
          <MapProjectReconPanel view={view} recon={recon} hasGeoreference={!!georeference} />
        </>}>
        <MapProjectCollabPanel view={view} collab={collab} shownProposal={shownProposal} onShowProposal={setShownProposal}
          shownArea={shownArea} onShowArea={setShownArea} newArea={!!newArea}
          onNewArea={() => { deselect(); cancelDraft(); setTool("area"); setPanelOpen(false); }}
          onSaveArea={(name, assignee) => {
            if (!newArea) return;
            void collab.createArea(name, [newArea], assignee).then(ok => { if (ok) { setNewArea(undefined); setTool("select"); } });
          }}
          onCancelArea={() => { setNewArea(undefined); setTool("select"); }} />
      </MapProjectSidebar>
    </div>
  </main>;
}

function SyncBadge({ sync, pending }: { sync: ReturnType<typeof useMapProjectEditor>["sync"]; pending: number }) {
  const copy = text.sync;
  const label = sync.kind === "offline" ? copy.offline : sync.kind === "error" ? copy.error(sync.status ?? 0)
    : sync.kind === "syncing" || pending > 0 ? `${copy.syncing}${pending ? ` ${copy.pending(pending)}` : ""}` : copy.synced;
  return <p className={styles.sync} role="status" data-testid="map-project-sync" data-state={sync.kind} data-pending={pending}>{label}</p>;
}

const NOTICES = ["noStore", "conflict", "conflictFirst", "rejected", "changedByOther", "proposed"] as const;
function noticeText(notice: string): string {
  const key = NOTICES.find(value => value === notice);
  return key ? text.sync[key] : notice;
}

export type { CatalogSymbol };
