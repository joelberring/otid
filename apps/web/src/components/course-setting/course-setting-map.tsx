"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { OverprintPrimitive } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { LegAnalysis } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { drawMarks, drawOverprint, drawRouteChoice } from "../../lib/course-setting-draw";
import { drawHighlightedRoute, drawNoteMarks, drawSuggestion, type SuggestionDrawing } from "../../lib/course-setting-draw-collaboration";
import { drawPosition } from "../../lib/course-setting-field";
import type { MapPosition } from "../../lib/course-setting-geo";
import { hitNoteMark, noteMarkGeometry, type NoteMark } from "../../lib/course-setting-note-marks";
import { MAX_RENDER_SIDE, type MapRenderSession } from "../../lib/course-setting-map-protocol";
import {
  bitmapPlacement, fitBounds, panBy, resize, toMap, topLeft, wheelAction, wheelFactor, zoomAt, type Bounds, type Viewport
} from "../../lib/course-setting-viewport";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/** Det kartan behöver veta om ett tryck: kartpunkten och om det var en dragning. */
export interface MapPointerHandlers {
  /** Ett klick (utan att dra). `toleranceMm` är träffytan för fingret eller musen. */
  readonly onTap: (point: Point, toleranceMm: number) => void;
  /** En dragning börjar på `point`. Sant = editorn drar något (kontroll, nummer, brytpunkt); falskt = kartan panoreras. */
  readonly onDragStart: (point: Point, toleranceMm: number) => boolean;
  readonly onDragMove: (point: Point) => void;
  readonly onDragEnd: () => void;
}

export interface CourseSettingMapHandle {
  /** Visar ytan (t.ex. en kontroll från kontrollistan) om den inte redan syns. */
  readonly reveal: (points: readonly Point[]) => void;
  /** Steg 66: zoomar in till punkten (en notis i listan). */
  readonly focus: (point: Point) => void;
}

const PAN_STEP_PX = 80;

interface Drawn { readonly bitmap: ImageBitmap; readonly view: Viewport }

const TAP_SLOP_PX = 5;
/** Träffytan i skärmpixlar: större med finger än med mus. */
const tolerancePx = (pointerType: string) => pointerType === "touch" ? 18 : 8;

/**
 * Steg 62: banläggningens karta. Kartfilen (Workern i `course-setting-map-worker.ts`) i ett lager och banpåtrycket,
 * markeringarna och vald sträckas vägval i ett eget lager ovanpå. Hjul och knappar zoomar, dra panorerar (eller drar det
 * editorn tar tag i), två fingrar zoomar. Medan en ny bild ritas visas den förra omskalad.
 *
 * Steg 66: notisernas markeringar (ett klick på en öppnar den), ett förslag ovanpå banan, handmarkören där kartan går att
 * dra (`cursorAt`), och piltangenterna panorerar när kartan har fokus (+ och − zoomar).
 */
export function CourseSettingMap({ session, mapBounds, primitives, faded, marks, analysis, label, cursor, handlers, handle, noteMarks,
  selectedNote, onNoteTap, suggestion, cursorAt, highlightRoute, position }: {
  session: MapRenderSession | undefined;
  mapBounds: Bounds | undefined;
  primitives: readonly OverprintPrimitive[];
  faded: readonly OverprintPrimitive[];
  marks: Parameters<typeof drawMarks>[2];
  analysis: LegAnalysis | undefined;
  label: string;
  cursor: string;
  handlers: MapPointerHandlers;
  handle?: Ref<CourseSettingMapHandle>;
  noteMarks?: readonly NoteMark[] | undefined;
  selectedNote?: string | undefined;
  onNoteTap?: ((id: string) => void) | undefined;
  suggestion?: SuggestionDrawing | undefined;
  /** Markören där pekaren står (utan att något dras); undefined = `cursor`. */
  cursorAt?: ((point: Point, toleranceMm: number) => string | undefined) | undefined;
  /** Vägvalet som är valt i listan. */
  highlightRoute?: readonly Point[] | undefined;
  /** Fältläget: telefonens position och om kartan följer den. */
  position?: { readonly position: MapPosition; readonly follow: boolean } | undefined;
}) {
  const [hoverCursor, setHoverCursor] = useState<string>();
  const [grabbing, setGrabbing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<Viewport>();
  const drawn = useRef<Drawn | undefined>(undefined);
  const overview = useRef<Drawn | undefined>(undefined);
  const [drawnVersion, setDrawnVersion] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pending" | "pan" | "drag" | "pinch"; startX: number; startY: number; lastX: number; lastY: number;
    distance?: number; pointerType: string } | undefined>(undefined);
  const viewRef = useRef<Viewport | undefined>(undefined);
  viewRef.current = view;

  // Storleken följer rutan; första gången visas hela kartan.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      setView(current => current ? resize(current, width, height) : mapBounds ? fitBounds(mapBounds, width, height) : current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mapBounds]);
  useEffect(() => {
    const element = box.current;
    if (!mapBounds || !element || view) return;
    const { width, height } = element.getBoundingClientRect();
    if (width > 0 && height > 0) setView(fitBounds(mapBounds, width, height));
  }, [mapBounds, view]);

  useImperativeHandle(handle, () => ({
    reveal(points) {
      const current = viewRef.current;
      if (!current || points.length === 0) return;
      const xs = points.map(point => point.x), ys = points.map(point => point.y);
      const area = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const corner = topLeft(current);
      const visible = area.minX >= corner.x && area.maxX <= corner.x + current.width / current.pxPerMm &&
        area.maxY <= corner.y && area.minY >= corner.y - current.height / current.pxPerMm;
      if (visible) return;
      const pad = 40 / current.pxPerMm;
      const fitted = fitBounds({ minX: area.minX - pad, maxX: area.maxX + pad, minY: area.minY - pad, maxY: area.maxY + pad }, current.width, current.height);
      setView({ ...fitted, pxPerMm: Math.min(fitted.pxPerMm, Math.max(current.pxPerMm, 2)) });
    },
    focus(point) {
      setView(current => current ? { ...current, centerX: point.x, centerY: point.y, pxPerMm: Math.max(current.pxPerMm, 6) } : current);
    }
  }), []);

  // Ny vy: beställ en skarp bild efter en kort paus (dra och zoom visar den förra omskalad under tiden).
  useEffect(() => {
    if (!session || !view) return;
    const timer = setTimeout(() => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SIDE / Math.max(view.width, view.height));
      const request = { width: view.width * ratio, height: view.height * ratio, pxPerMm: view.pxPerMm * ratio, origin: topLeft(view) };
      session.render(request, (_id, bitmap) => {
        const next = { bitmap, view };
        if (!overview.current) overview.current = next;
        else if (drawn.current && drawn.current !== overview.current) drawn.current.bitmap.close();
        drawn.current = next;
        setDrawnVersion(version => version + 1);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [session, view]);
  useEffect(() => () => {
    if (drawn.current && drawn.current !== overview.current) drawn.current.bitmap.close();
    overview.current?.bitmap.close();
  }, []);

  // Kartlagret: översikten under, den senaste bilden ovanpå, båda flyttade till vyn.
  useEffect(() => {
    const canvas = base.current;
    if (!canvas || !view) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * ratio); canvas.height = Math.round(view.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, view.width, view.height);
    const layers = overview.current === drawn.current ? [drawn.current] : [overview.current, drawn.current];
    for (const layer of layers) {
      if (!layer) continue;
      const place = bitmapPlacement(layer.view, view);
      ctx.drawImage(layer.bitmap, place.x, place.y, place.width, place.height);
    }
  }, [view, drawnVersion]);

  // Banpåtrycket, markeringarna och vägvalen.
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas || !view) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * ratio); canvas.height = Math.round(view.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    if (highlightRoute) drawHighlightedRoute(ctx, view, highlightRoute);
    if (analysis) drawRouteChoice(ctx, view, analysis);
    drawOverprint(ctx, view, faded, { faded: true });
    drawOverprint(ctx, view, primitives);
    if (suggestion) drawSuggestion(ctx, view, suggestion);
    drawMarks(ctx, view, marks);
    if (noteMarks) drawNoteMarks(ctx, view, noteMarks.map(mark => ({ ...mark, selected: mark.id === selectedNote })));
    if (position) drawPosition(ctx, view, position.position);
  }, [view, primitives, faded, marks, analysis, suggestion, noteMarks, selectedNote, highlightRoute, position]);
  const followX = position?.follow ? position.position.at.x : undefined, followY = position?.follow ? position.position.at.y : undefined;
  useEffect(() => {
    if (followX !== undefined && followY !== undefined) setView(previous => previous ? { ...previous, centerX: followX, centerY: followY } : previous);
  }, [followX, followY]);

  function local(event: { clientX: number; clientY: number }) {
    const rect = box.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!view || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size === 2) {
      if (gesture.current?.kind === "drag") handlers.onDragEnd();
      gesture.current = { kind: "pinch", startX: at.x, startY: at.y, lastX: at.x, lastY: at.y, distance: pinchDistance(), pointerType: event.pointerType };
      return;
    }
    gesture.current = { kind: "pending", startX: at.x, startY: at.y, lastX: at.x, lastY: at.y, pointerType: event.pointerType };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current && view && cursorAt && event.pointerType === "mouse") {
      const point = toMap(view, local(event));
      const tolerance = tolerancePx(event.pointerType) / view.pxPerMm;
      const overNote = noteMarks && hitNoteMark(noteMarks, point, tolerance, noteMarkGeometry(view.pxPerMm));
      setHoverCursor(overNote ? "pointer" : cursorAt(point, tolerance));
    }
    if (!current || !view || !pointers.current.has(event.pointerId)) return;
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (current.kind === "pinch") {
      const distance = pinchDistance();
      const [a, b] = [...pointers.current.values()];
      if (current.distance && distance > 0 && a && b) {
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        setView(previous => previous ? zoomAt(previous, distance / current.distance!, center) : previous);
        current.distance = distance;
      }
      return;
    }
    if (current.kind === "pending") {
      if (Math.hypot(at.x - current.startX, at.y - current.startY) < TAP_SLOP_PX) return;
      const start = toMap(view, { x: current.startX, y: current.startY });
      current.kind = handlers.onDragStart(start, tolerancePx(current.pointerType) / view.pxPerMm) ? "drag" : "pan";
      if (current.kind === "pan") setGrabbing(true);
    }
    if (current.kind === "drag") handlers.onDragMove(toMap(view, at));
    else setView(previous => previous ? panBy(previous, at.x - current.lastX, at.y - current.lastY) : previous);
    current.lastX = at.x; current.lastY = at.y;
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (!current || !view) return;
    if (current.kind === "pinch") { if (pointers.current.size === 0) gesture.current = undefined; return; }
    gesture.current = undefined;
    setGrabbing(false);
    if (current.kind === "pending" && event.type === "pointerup") {
      const point = toMap(view, { x: current.startX, y: current.startY });
      const tolerance = tolerancePx(current.pointerType) / view.pxPerMm;
      const note = noteMarks && onNoteTap ? hitNoteMark(noteMarks, point, tolerance, noteMarkGeometry(view.pxPerMm)) : undefined;
      if (note) onNoteTap!(note.id);
      else handlers.onTap(point, tolerance);
    } else if (current.kind === "drag") handlers.onDragEnd();
  }

  // Mushjulet och nyp zoomar kring pekaren, två fingrar på styrplattan panorerar (`wheelAction`). Passiv lyssnare går
  // inte att stoppa, därför här.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (wheelAction(event) === "pan") setView(previous => previous ? panBy(previous, -event.deltaX, -event.deltaY) : previous);
      else setView(previous => previous ? zoomAt(previous, wheelFactor(event.deltaY, event.deltaMode), at) : previous);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const zoom = (factor: number) => setView(previous => previous ? zoomAt(previous, factor) : previous);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP_PX, 0], ArrowRight: [-PAN_STEP_PX, 0], ArrowUp: [0, PAN_STEP_PX],
      ArrowDown: [0, -PAN_STEP_PX] };
    const move = moves[event.key];
    if (move) { event.preventDefault(); setView(previous => previous ? panBy(previous, move[0], move[1]) : previous); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
    else if (event.key === "-") { event.preventDefault(); zoom(1 / 1.25); }
  }
  return <div className={styles.mapFrame}>
    <div ref={box} className={styles.map} role="img" aria-label={label} tabIndex={0} onKeyDown={onKeyDown}
      style={{ cursor: grabbing ? "grabbing" : hoverCursor ?? cursor }} data-testid="course-setting-map"
      data-px-per-mm={view ? view.pxPerMm.toFixed(3) : undefined}
      data-center={view ? `${view.centerX.toFixed(2)},${view.centerY.toFixed(2)}` : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <canvas ref={base} className={styles.layer} aria-hidden="true" />
      <canvas ref={overlay} className={styles.layer} aria-hidden="true" data-testid="course-setting-overprint" />
    </div>
    <div className={styles.zoom} role="group" aria-label={text.fit}>
      <Button variant="secondary" aria-label={text.zoomIn} title={text.zoomIn} onClick={() => zoom(1.5)}>+</Button>
      <Button variant="secondary" aria-label={text.zoomOut} title={text.zoomOut} onClick={() => zoom(1 / 1.5)}>−</Button>
      <Button variant="secondary" aria-label={text.fit} title={text.fit} disabled={!mapBounds}
        onClick={() => setView(previous => previous && mapBounds ? fitBounds(mapBounds, previous.width, previous.height) : previous)}>⤢</Button>
    </div>
  </div>;
}
