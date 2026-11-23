"use client";

import { useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import type { MapNorm, ObjectKey } from "@o-tid/map-revision";
import { mergeFaceRings } from "@o-tid/map-revision/faces";
import type { FillOverlay } from "../../lib/map-project-fill-over";
import type { MapProjectSession } from "../../lib/map-project-protocol";

/** Steget mellan punkterna längs en dragning (m i terrängen), så att också små rutor man drar snabbt över kommer med. */
const DRAG_STEP_M = 0.5;

/** Samlade rutor: hur många och hur stora, och hur många som hoppades över (inte slutna eller redan fyllda). */
export interface FillCells { readonly count: number; readonly areaM2: number; readonly open: number; readonly covered: number }

/** Ligger punkten i ringarna (jämn–udda, så att hål räknas)? */
export function insideRings(rings: readonly (readonly Point[])[], point: Point): boolean {
  let inside = false;
  for (const ring of rings) for (let at = 0, previous = ring.length - 1; at < ring.length; previous = at, at += 1) {
    const a = ring[at]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * K8b V4 (magisk fyll, dra över flera rutor): rutorna man drar över (eller lägger till med Skift+klick, eller med «+ ruta» i
 * telefonen) samlas och visas som en yta; delade kanter tas bort och hålen behålls (`mergeFaceRings`). Frågorna till Workern
 * går en i taget, och en punkt som redan ligger i en samlad ruta frågas inte. Rutor som inte är slutna eller redan täcks av en
 * yta hoppas över och räknas. K8b V7 Fyll över (`over`): varje rutas svar säger vad som klipps under den (`removed`, `over`).
 */
export function useMapProjectFillCells(input: { session: MapProjectSession | undefined; hidden: readonly string[]; gapM: number; scale: number | undefined;
  over?: MapNorm | undefined; symbol?: string | undefined }) {
  const faces = useRef<{ rings: Point[][]; areaM2: number; overlay?: FillOverlay | undefined }[]>([]);
  const [removed, setRemoved] = useState<Point[][][]>();
  const [over, setOver] = useState<{ count: number; codes: readonly string[] }>({ count: 0, codes: [] });
  const [rings, setRings] = useState<Point[][]>();
  const [cells, setCells] = useState<FillCells>({ count: 0, areaM2: 0, open: 0, covered: 0 });
  const counts = useRef({ open: 0, covered: 0, lastOpen: false });
  const queue = useRef<Point[]>([]);
  const busy = useRef(false);
  /** Körs när kön är tom (t.ex. lägg in när musknappen släppts). */
  const idle = useRef<(() => void) | undefined>(undefined);
  const last = useRef<Point | undefined>(undefined);

  function publish() {
    const merged = mergeFaceRings(faces.current.map(face => face.rings)).flat();
    setRings(merged.length ? merged : undefined);
    const overlays = faces.current.flatMap(face => face.overlay ? [face.overlay] : []);
    setRemoved(overlays.length ? overlays.flatMap(overlay => overlay.removed) : undefined);
    setOver({ count: new Set<ObjectKey>(overlays.flatMap(overlay => overlay.keys)).size, codes: [...new Set(overlays.flatMap(overlay => overlay.codes))].sort() });
    setCells({ count: faces.current.length, areaM2: faces.current.reduce((sum, face) => sum + face.areaM2, 0), open: counts.current.open, covered: counts.current.covered });
  }

  function next() {
    const session = input.session;
    for (;;) {
      const point = queue.current.shift();
      if (!point || !session) { busy.current = false; const done = idle.current; idle.current = undefined; done?.(); return; }
      if (faces.current.some(face => insideRings(face.rings, point))) continue;
      busy.current = true;
      session.fill({ point, hidden: input.hidden, diagnose: false, gapM: input.gapM, over: input.over, symbol: input.symbol }, (result, _covered, _under, overlay) => {
        if (result.status !== "found") {
          // En öppen ruta räknas en gång per sträcka man drar genom den.
          if (!counts.current.lastOpen) counts.current.open += 1;
          counts.current.lastOpen = true;
        } else if (result.covered) { counts.current.lastOpen = false; counts.current.covered += 1; }
        else { counts.current.lastOpen = false; faces.current.push({ rings: result.rings, areaM2: result.areaM2, overlay }); }
        publish();
        next();
      });
      return;
    }
  }

  function add(point: Point) {
    queue.current.push(point);
    if (!busy.current) next();
  }

  /** En punkt längs dragningen; punkterna emellan fylls i med `DRAG_STEP_M`. */
  function track(point: Point) {
    const from = last.current, step = DRAG_STEP_M * 1000 / (input.scale ?? 4000);
    last.current = point;
    if (from) {
      const count = Math.min(200, Math.floor(Math.hypot(point.x - from.x, point.y - from.y) / step));
      for (let at = 1; at <= count; at += 1) queue.current.push({ x: from.x + (point.x - from.x) * at / (count + 1), y: from.y + (point.y - from.y) * at / (count + 1) });
    }
    add(point);
  }

  /** När frågorna som är ute är klara. */
  function whenIdle(done: () => void) {
    if (busy.current || queue.current.length) idle.current = done; else done();
  }

  function clear() {
    faces.current = []; queue.current = []; last.current = undefined; idle.current = undefined;
    counts.current = { open: 0, covered: 0, lastOpen: false };
    setRings(undefined); setCells({ count: 0, areaM2: 0, open: 0, covered: 0 }); setRemoved(undefined); setOver({ count: 0, codes: [] });
  }

  /** Dragningen är slut: nästa dragning börjar en ny sträcka. */
  function lift() { last.current = undefined; counts.current.lastOpen = false; }

  return { rings, cells, removed, over, add, track, lift, whenIdle, clear, busy: () => busy.current,
    /** Den samlade ytan just nu (ringarna, ytan och vad som hoppades över), ur referenserna (inte väntande tillstånd). */
    current: () => ({ rings: mergeFaceRings(faces.current.map(face => face.rings)).flat(), count: faces.current.length,
      areaM2: faces.current.reduce((sum, face) => sum + face.areaM2, 0), open: counts.current.open, covered: counts.current.covered }) };
}
