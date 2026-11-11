"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { courseSettingEn } from "../../i18n/course-setting-en";
import { useTexts } from "../language-provider";
import type { OverprintPrimitive, TrainingMapPass } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { LegAnalysis } from "@o-tid/route-choice";
import { courseSettingSv } from "../../i18n/course-setting-sv";
import { overprintProbe } from "../../lib/course-setting-appearance";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { drawMarks, drawOverprint, drawRouteChoice } from "../../lib/course-setting-draw";
import { drawHighlightedRoute, drawNoteMarks, drawSuggestion, type SuggestionDrawing } from "../../lib/course-setting-draw-collaboration";
import { drawDragGuide, liftedPoint, type CenterCross } from "../../lib/course-setting-draw-cross";
import { drawPosition } from "../../lib/course-setting-field";
import { drawInspected } from "../../lib/course-setting-inspections";
import type { MapPosition } from "../../lib/course-setting-geo";
import { hitNoteMark, noteMarkGeometry, type NoteMark } from "../../lib/course-setting-note-marks";
import { drawSketchShapes } from "../../lib/course-setting-draw-sketch";
import { hitSketch } from "../../lib/course-setting-sketch";
import type { CourseSettingSketchShape } from "@o-tid/contracts";
import { MAX_RENDER_SIDE, type MapRenderSession } from "../../lib/course-setting-map-protocol";
import {
  bitmapPlacement, fitBounds, NO_INSETS, panBy, resize, toMap, toScreen, topLeft, wheelAction, wheelFactor, zoomAt, type Bounds, type Insets, type Viewport
} from "../../lib/course-setting-viewport";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/** ADR-0180 beslut 14: tangenterna och fingrarna vid ett klick eller en dragning. */
export interface PointerModifiers {
  readonly alt: boolean;
  /** Cmd eller Ctrl hölls nere (kartprojektets ritläge: ta bort eller lägg till en punkt med ett klick). */
  readonly command?: boolean | undefined;
  /** Skift eller ett andra finger: fri vinkel när man vrider. */
  readonly free: boolean;
  readonly pointerType: string;
  /** Skärmpixlar per mm i vyn (handtag och fångavstånd räknas i skärmpixlar). */
  readonly pxPerMm: number;
}

/** Det kartan behöver veta om ett tryck: kartpunkten och om det var en dragning. */
export interface MapPointerHandlers {
  /** Ett klick (utan att dra). `toleranceMm` är träffytan för fingret eller musen. */
  readonly onTap: (point: Point, toleranceMm: number, modifiers: PointerModifiers) => void;
  /** En dragning börjar på `point`. Sant = editorn drar något (kontroll, nummer, brytpunkt); falskt = kartan panoreras. */
  /** `pointerType` "touch": editorn kan kräva att kontrollen redan är vald (skydd mot att flytta av misstag med fingret). */
  /** `heldMs`: hur länge pekaren varit nere innan den började röra sig (fingret: ett kort håll innan något markerat följer med). */
  readonly onDragStart: (point: Point, toleranceMm: number, pointerType: string, pxPerMm: number, heldMs: number) => boolean;
  readonly onDragMove: (point: Point, modifiers: PointerModifiers) => void;
  readonly onDragEnd: () => void;
  /** Pekaren över kartan utan att något dras (musen, eller fingret som just tryckts ned); undefined = utanför. */
  readonly onHover?: ((point: Point | undefined, modifiers: PointerModifiers) => void) | undefined;
  /** Ett andra finger under en dragning: sant = dragningen fortsätter (fri vinkel), falskt = kartan zoomas. */
  readonly onSecondPointer?: (() => boolean) | undefined;
  /** ADR-0181 beslut 8: ett andra finger kom under dragningen (ritläget kastar strecket; annars `onDragEnd`). */
  readonly onDragCancel?: (() => void) | undefined;
  /** Dragningen följer fingret där det är (ritläget), inte en bit ovanför (`liftedPoint`). */
  readonly unlifted?: boolean | undefined;
  /**
   * Högerklick, eller ett långt tryck med fingret som inte rör sig (kartritningens verktygshjul). `screen` är punkten i
   * kartrutans pixlar. Saknas = webbläsarens egen meny.
   */
  readonly onContextMenu?: ((point: Point, screen: { readonly x: number; readonly y: number }, toleranceMm: number) => void) | undefined;
}

/** Ett långt tryck med fingret (ms) öppnar `onContextMenu`. */
const LONG_PRESS_MS = 550;

/** ADR-0181 beslut 8: notisernas ritningar (ett klick väljer notisen) och ritningen som pågår. Bara på skärmen. */
export interface SketchLayer {
  readonly notes: readonly { readonly id: string; readonly shapes: readonly CourseSettingSketchShape[]; readonly done: boolean }[];
  readonly draft?: readonly CourseSettingSketchShape[] | undefined;
}

export interface CourseSettingMapHandle {
  /** Visar ytan (t.ex. en kontroll från kontrollistan) om den inte redan syns. */
  readonly reveal: (points: readonly Point[]) => void;
  /** Steg 66: zoomar in till punkten (en notis i listan). */
  readonly focus: (point: Point) => void;
}

const PAN_STEP_PX = 80;

interface Drawn { readonly bitmap: ImageBitmap; readonly view: Viewport; readonly passes?: number | undefined }

const TAP_SLOP_PX = 5;
/** Träffytan i skärmpixlar: större med finger än med mus. */
const tolerancePx = (pointerType: string) => pointerType === "touch" ? 18 : 8;

/**
 * Steg 62: banläggningens karta. Kartfilen (Workern i `course-setting-map-worker.ts`) i ett lager och banpåtrycket,
 * markeringarna och vald sträckas vägval i ett eget lager ovanpå. Hjul och knappar zoomar, dra panorerar (eller drar det
 * editorn tar tag i), två fingrar zoomar. Medan en ny bild ritas visas den förra omskalad.
 *
 * Steg 66: notisernas markeringar (ett klick på en öppnar den), ett förslag ovanpå banan, handmarkören där kartan går att
 * dra (`cursorAt`), och piltangenterna panorerar när kartan har fokus (+ och − zoomar). Krysset i vald kontrolls mitt i
 * ett eget lager som bara finns på skärmen; en dragning med fingret lyfts ovanför fingret (`liftedPoint`).
 */
export function CourseSettingMap({ session, mapBounds, primitives, faded, ghosts, others, marks, analysis, label, cursor, handlers, handle, noteMarks,
  selectedNote, onNoteTap, suggestion, cursorAt, highlightRoute, position, cross, inspected, onPan, symbols, overlayExtra, sketches, mapPasses, renderKey,
  hiddenSymbols, dimmedSymbols }: {
  /** Bara `render` används (kartprojektets editor har en egen Worker med samma beställning, ADR-0219). */
  session: Pick<MapRenderSession, "render"> | undefined;
  mapBounds: Bounds | undefined;
  primitives: readonly OverprintPrimitive[];
  faded: readonly OverprintPrimitive[];
  /** ADR-0180 beslut 14: kontroller som inte är med i banan (svagt, med kod) och andra banor (svagt). */
  ghosts?: readonly OverprintPrimitive[] | undefined;
  others?: readonly OverprintPrimitive[] | undefined;
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
  /** Fältläget: telefonens position, om kartan följer den och kompassens riktning (steg 67). */
  position?: { readonly position: MapPosition; readonly follow: boolean; readonly heading?: number | undefined } | undefined;
  /** Steg 67: kollade kontroller (diskret bock, bara på skärmen). */
  inspected?: readonly { at: Point; moved: boolean }[] | undefined;
  /** Steg 67: kartan panorerades med fingret eller musen ("Följ" släpper). */
  onPan?: (() => void) | undefined;
  /** Krysset i vald kontrolls mitt (bara på skärmen). */
  cross?: CenterCross | undefined;
  /** Steg 64: symbolerna för beskrivningen på kartan. */
  symbols?: SymbolLookup | undefined;
  /** Steg 64: ritas ovanpå banpåtrycket (specialobjektets punkter under redigering, tryckytans ram). */
  overlayExtra?: ((ctx: CanvasRenderingContext2D, view: Viewport) => void) | undefined;
  sketches?: SketchLayer | undefined;
  /** Träningsläget (ADR-0192): kartan i pass med klippning och filter (före och efter syns direkt). */
  mapPasses?: readonly TrainingMapPass[] | undefined;
  /**
   * ADR-0219 (K1): kartan har ändrats (kartprojektets ändringar): ny bild för samma vy, och översikten gäller inte längre.
   * Vilket värde som helst; en ändring räcker.
   */
  renderKey?: unknown;
  /** ADR-0219 (K1): symbolerna (id) som inte ritas (lagren i kartprojektets editor). */
  hiddenSymbols?: readonly string[] | undefined;
  /** Kartprojektet: låsta lager som ritas nedtonade. */
  dimmedSymbols?: readonly string[] | undefined;
}) {
  const text = useTexts(courseSettingSv, courseSettingEn);
  const [imageVersion, setImageVersion] = useState(0);
  const [hoverCursor, setHoverCursor] = useState<string>();
  const [grabbing, setGrabbing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const screen = useRef<HTMLCanvasElement>(null);
  /** Fingret under en lyft dragning (skärmpixlar), för linjen till kontrollen. */
  const [finger, setFinger] = useState<{ x: number; y: number }>();
  const [view, setViewState] = useState<Viewport>();
  /**
   * Kartan har inte flyttats eller zoomats av användaren: en ny storlek på rutan passar in hela kartan igen (t.ex. när
   * sidans stilar laddas efter första mätningen, eller telefonen vrids). Annars behålls mitten och skalan.
   */
  const untouched = useRef(true);
  const setView: typeof setViewState = next => { untouched.current = false; setViewState(next); };
  const drawn = useRef<Drawn | undefined>(undefined);
  const overview = useRef<Drawn | undefined>(undefined);
  const staleOverview = useRef(false);
  const [drawnVersion, setDrawnVersion] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longPress = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressAt = useRef(0);
  const gesture = useRef<{ kind: "pending" | "pan" | "drag" | "pinch"; startX: number; startY: number; lastX: number; lastY: number;
    distance?: number; pointerType: string; pointerId?: number; free?: boolean; alt?: boolean; shift?: boolean; command?: boolean; downAt?: number } | undefined>(undefined);
  const viewRef = useRef<Viewport | undefined>(undefined);
  viewRef.current = view;

  /**
   * Det som ligger ovanpå kartan (verktygsraden till vänster, telefonens rader nedtill; märkta `data-map-overlay`), så att
   * hela kartan visas där den går att ta på.
   */
  const insets = (): Insets => {
    const element = box.current;
    // Kartans ram ligger i samma yta som verktygen (editorns `mapArea`).
    const parent = element?.parentElement?.parentElement;
    if (!element || !parent) return NO_INSETS;
    const area = element.getBoundingClientRect();
    let left = 0, bottom = 0;
    for (const overlay of parent.querySelectorAll<HTMLElement>("[data-map-overlay]")) {
      const rect = overlay.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left - area.left < 40 && rect.height > rect.width) left = Math.max(left, rect.right - area.left);
      else if (area.bottom - rect.bottom < 80 && rect.width > rect.height) bottom = Math.max(bottom, area.bottom - rect.top);
    }
    return { left, right: 0, top: 0, bottom };
  };
  // Storleken följer rutan; första gången visas hela kartan.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      setViewState(current => current && !untouched.current ? resize(current, width, height)
        : mapBounds ? fitBounds(mapBounds, width, height, undefined, insets()) : current ? resize(current, width, height) : current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mapBounds]);
  useEffect(() => {
    const element = box.current;
    if (!mapBounds || !element || view) return;
    const { width, height } = element.getBoundingClientRect();
    if (width > 0 && height > 0) setViewState(fitBounds(mapBounds, width, height, undefined, insets()));
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
      const fitted = fitBounds({ minX: area.minX - pad, maxX: area.maxX + pad, minY: area.minY - pad, maxY: area.maxY + pad }, current.width, current.height,
        undefined, insets());
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
      const request = { width: view.width * ratio, height: view.height * ratio, pxPerMm: view.pxPerMm * ratio, origin: topLeft(view),
        ...(mapPasses ? { passes: mapPasses } : {}), ...(hiddenSymbols ? { hiddenSymbols } : {}),
        ...(dimmedSymbols?.length ? { dimmedSymbols } : {}) };
      session.render(request, (_id, bitmap) => {
        const next = { bitmap, view, passes: mapPasses?.length ?? 0 };
        if (staleOverview.current) {
          // Träningen ändrades: den nya bilden blir översikten och de gamla bilderna släpps.
          staleOverview.current = false;
          if (overview.current && overview.current !== drawn.current) overview.current.bitmap.close();
          drawn.current?.bitmap.close();
          overview.current = undefined;
          drawn.current = undefined;
        }
        if (!overview.current) overview.current = next;
        else if (drawn.current && drawn.current !== overview.current) drawn.current.bitmap.close();
        drawn.current = next;
        setDrawnVersion(version => version + 1);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [session, view, mapPasses, renderKey, hiddenSymbols, dimmedSymbols]);
  // En ny träning, ändrad karta eller andra lager: översiktsbilden gäller inte längre (den ritades med det gamla) och byts mot
  // nästa bild.
  const passesRef = useRef<unknown[]>([mapPasses, renderKey, hiddenSymbols, dimmedSymbols]);
  useEffect(() => {
    const [passes, key, hidden, dimmed] = passesRef.current;
    if (passes === mapPasses && key === renderKey && hidden === hiddenSymbols && dimmed === dimmedSymbols) return;
    passesRef.current = [mapPasses, renderKey, hiddenSymbols, dimmedSymbols];
    staleOverview.current = true;
  }, [mapPasses, renderKey, hiddenSymbols, dimmedSymbols]);
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
    const onImage = () => setImageVersion(value => value + 1);
    if (others?.length) drawOverprint(ctx, view, others, { alpha: 0.22, symbols, onImage });
    if (ghosts?.length) drawOverprint(ctx, view, ghosts, { alpha: 0.4, symbols, onImage });
    drawOverprint(ctx, view, faded, { faded: true, symbols, onImage });
    drawOverprint(ctx, view, primitives, { symbols, onImage });
    if (suggestion) drawSuggestion(ctx, view, suggestion);
    drawMarks(ctx, view, marks);
    if (inspected) drawInspected(ctx, view, inspected, marks.radiusMm);
    const atScreen = (point: Point) => toScreen(view, point);
    for (const note of sketches?.notes ?? []) drawSketchShapes(ctx, atScreen, note.shapes, { done: note.done, selected: note.id === selectedNote });
    if (noteMarks) drawNoteMarks(ctx, view, noteMarks.map(mark => ({ ...mark, selected: mark.id === selectedNote })));
    if (sketches?.draft) drawSketchShapes(ctx, atScreen, sketches.draft);
    if (position) drawPosition(ctx, view, position.position, position.heading);
    overlayExtra?.(ctx, view);
  }, [view, primitives, faded, ghosts, others, marks, analysis, suggestion, noteMarks, selectedNote, highlightRoute, position, inspected, symbols, imageVersion,
    overlayExtra, sketches]);
  // Skärmlagret: det stora krysset medan man drar (och fingrets linje). Aldrig i banpåtrycket, dolt vid utskrift.
  const crossX = cross?.at.x, crossY = cross?.at.y, crossDragging = cross?.dragging, radiusMm = marks.radiusMm;
  useEffect(() => {
    const canvas = screen.current;
    if (!canvas || !view) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * ratio); canvas.height = Math.round(view.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    if (crossX !== undefined && crossY !== undefined) {
      drawDragGuide(ctx, view, { at: { x: crossX, y: crossY }, dragging: crossDragging ?? false }, radiusMm, finger);
    }
  }, [view, crossX, crossY, crossDragging, radiusMm, finger]);
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
    if (pointers.current.size === 2 && gesture.current?.kind === "drag" && handlers.onSecondPointer?.()) {
      // Ett andra finger medan man vrider: dragningen fortsätter med fri vinkel (ADR-0180 beslut 14).
      gesture.current.free = true;
      return;
    }
    if (pointers.current.size === 2) {
      if (gesture.current?.kind === "drag") (handlers.onDragCancel ?? handlers.onDragEnd)();
      const [a, b] = [...pointers.current.values()];
      const middle = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : at;
      onPan?.();
      gesture.current = { kind: "pinch", startX: middle.x, startY: middle.y, lastX: middle.x, lastY: middle.y, distance: pinchDistance(),
        pointerType: event.pointerType };
      return;
    }
    gesture.current = { kind: "pending", startX: at.x, startY: at.y, lastX: at.x, lastY: at.y, pointerType: event.pointerType, pointerId: event.pointerId,
      alt: event.altKey, shift: event.shiftKey, command: event.metaKey || event.ctrlKey, downAt: performance.now() };
    if (event.pointerType !== "mouse" && handlers.onContextMenu) {
      const started = gesture.current, current = view;
      clearTimeout(longPress.current);
      longPress.current = setTimeout(() => {
        if (gesture.current !== started || started.kind !== "pending") return;
        gesture.current = undefined;
        pointers.current.clear();
        longPressAt.current = Date.now();
        handlers.onContextMenu?.(toMap(current, at), at, tolerancePx(started.pointerType) / current.pxPerMm);
      }, LONG_PRESS_MS);
    }
    // Fingret har ingen muspekare: markeringen före klicket (t.ex. "Lägg in 45") visas när fingret trycks ned.
    if (event.pointerType !== "mouse") handlers.onHover?.(toMap(view, at), modifiersOf(event, view));
  }

  function modifiersOf(event: { altKey: boolean; shiftKey: boolean; pointerType: string }, current: Viewport, free = false): PointerModifiers {
    return { alt: event.altKey, free: free || event.shiftKey, pointerType: event.pointerType, pxPerMm: current.pxPerMm };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current && view && cursorAt && event.pointerType === "mouse") {
      const point = toMap(view, local(event));
      const tolerance = tolerancePx(event.pointerType) / view.pxPerMm;
      const overNote = (noteMarks && hitNoteMark(noteMarks, point, tolerance, noteMarkGeometry(view.pxPerMm)))
        || (sketches && !sketches.draft && hitSketch(sketches.notes, point, tolerance));
      setHoverCursor(overNote ? "pointer" : cursorAt(point, tolerance));
    }
    if (!current && view && event.pointerType === "mouse") handlers.onHover?.(toMap(view, local(event)), modifiersOf(event, view));
    if (!current || !view || !pointers.current.has(event.pointerId)) return;
    // Under en vridning med två fingrar styr det första fingret.
    if (current.kind === "drag" && current.pointerId !== undefined && event.pointerId !== current.pointerId) return;
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (current.kind === "pinch") {
      const distance = pinchDistance();
      const [a, b] = [...pointers.current.values()];
      if (current.distance && distance > 0 && a && b) {
        // Två fingrar: zooma kring mitten mellan fingrarna och följ mitten när fingrarna flyttas (värdena räknas nu,
        // eftersom uppdateringen körs efter händelsen).
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const factor = distance / current.distance;
        const dx = center.x - current.lastX, dy = center.y - current.lastY;
        setView(previous => previous ? zoomAt(panBy(previous, dx, dy), factor, center) : previous);
        current.distance = distance;
        current.lastX = center.x; current.lastY = center.y;
      }
      return;
    }
    if (current.kind === "pending") {
      if (Math.hypot(at.x - current.startX, at.y - current.startY) < TAP_SLOP_PX) return;
      clearTimeout(longPress.current);
      const start = toMap(view, { x: current.startX, y: current.startY });
      current.kind = handlers.onDragStart(start, tolerancePx(current.pointerType) / view.pxPerMm, current.pointerType, view.pxPerMm,
        performance.now() - (current.downAt ?? 0)) ? "drag" : "pan";
      if (current.kind === "pan") handlers.onHover?.(undefined, modifiersOf(event, view));
      if (current.kind === "pan") { setGrabbing(true); onPan?.(); }
    }
    if (current.kind === "drag") {
      handlers.onDragMove(toMap(view, handlers.unlifted ? at : liftedPoint(at, current.pointerType)), modifiersOf(event, view, current.free));
      if (current.pointerType === "touch" && !handlers.unlifted) setFinger(at);
    }
    else {
      // Förflyttningen räknas nu, inte i uppdateringen: React kan köra den efter att `lastX`/`lastY` har flyttats fram
      // (då blev panoreringen noll, märkbart med fingret på telefonen).
      const dx = at.x - current.lastX, dy = at.y - current.lastY;
      setView(previous => previous ? panBy(previous, dx, dy) : previous);
    }
    current.lastX = at.x; current.lastY = at.y;
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    clearTimeout(longPress.current);
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (!current || !view) return;
    if (current.kind === "pinch") { if (pointers.current.size === 0) gesture.current = undefined; return; }
    // Det andra fingret släpps under en vridning: dragningen fortsätter med det första.
    if (current.kind === "drag" && current.pointerId !== undefined && event.pointerId !== current.pointerId) return;
    gesture.current = undefined;
    setGrabbing(false);
    setFinger(undefined);
    if (current.kind === "pending" && event.type === "pointerup") {
      const point = toMap(view, { x: current.startX, y: current.startY });
      const tolerance = tolerancePx(current.pointerType) / view.pxPerMm;
      const tappable = onNoteTap && !sketches?.draft;
      const note = tappable ? (noteMarks && hitNoteMark(noteMarks, point, tolerance, noteMarkGeometry(view.pxPerMm)))
        || (sketches && hitSketch(sketches.notes, point, tolerance)) : undefined;
      if (note) onNoteTap!(note.id);
      else handlers.onTap(point, tolerance, { alt: current.alt ?? false, command: current.command ?? false, free: current.shift ?? false, pointerType: current.pointerType, pxPerMm: view.pxPerMm });
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
  // Numrens texter och ringens storlek som attribut (Playwright läser dem; själva ritningen är en canvas).
  const probe = useMemo(() => overprintProbe(primitives), [primitives]);
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
      style={{ cursor: grabbing ? "grabbing" : (cursorAt && hoverCursor) || cursor }} data-testid="course-setting-map"
      data-sketching={sketches?.draft ? "true" : undefined}
      data-px-per-mm={view ? view.pxPerMm.toFixed(3) : undefined}
      data-passes={drawn.current?.passes ?? ""}
      data-center={view ? `${view.centerX.toFixed(2)},${view.centerY.toFixed(2)}` : undefined}
      data-heading={position?.heading} data-follow={position?.follow || undefined} data-position={position ? "" : undefined}
      // Kartan är ritad skarpt för vyn som visas (specarna väntar på den före skärmbilder).
      data-drawn={drawnVersion > 0 && drawn.current?.view === view ? "true" : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onContextMenu={handlers.onContextMenu ? event => {
        event.preventDefault();
        // Telefonens eget långa tryck kommer också hit: bara ett hjul.
        clearTimeout(longPress.current);
        if (!view || Date.now() - longPressAt.current < 1000) return;
        gesture.current = undefined;
        const at = local(event);
        handlers.onContextMenu?.(toMap(view, at), at, tolerancePx("mouse") / view.pxPerMm);
      } : undefined}
      onPointerLeave={event => { if (event.pointerType === "mouse" && view) handlers.onHover?.(undefined, modifiersOf(event, view)); }}>
      <canvas ref={base} className={styles.layer} aria-hidden="true" />
      <canvas ref={overlay} className={styles.layer} aria-hidden="true" data-testid="course-setting-overprint"
        data-labels={probe.labels} data-ring-mm={probe.ring}
        data-marks={`inspected:${inspected?.length ?? 0},notes:${noteMarks?.length ?? 0},flagged:${marks.flagged.length}`} />
      <canvas ref={screen} className={`${styles.layer} ${styles.screenOnly}`} aria-hidden="true" data-testid="course-setting-cross"
        data-cross={cross ? `${cross.at.x.toFixed(2)},${cross.at.y.toFixed(2)}${cross.dragging ? ",drag" : ""}` : undefined} />
    </div>
    <div className={styles.zoom} role="group" aria-label={text.fit}>
      <Button variant="secondary" aria-label={text.zoomIn} title={text.zoomIn} onClick={() => zoom(1.5)}>+</Button>
      <Button variant="secondary" aria-label={text.zoomOut} title={text.zoomOut} onClick={() => zoom(1 / 1.5)}>−</Button>
      <Button variant="secondary" aria-label={text.fit} title={text.fit} disabled={!mapBounds}
        onClick={() => { setViewState(previous => previous && mapBounds ? fitBounds(mapBounds, previous.width, previous.height, undefined, insets()) : previous);
          untouched.current = true; }}>⤢</Button>
    </div>
  </div>;
}
