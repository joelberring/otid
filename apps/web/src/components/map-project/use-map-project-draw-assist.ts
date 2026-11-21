"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import type { PointerModifiers } from "../course-setting/course-setting-map";
import { angleReference, followEdge, lockAngle, snapOnRay } from "../../lib/map-project-draw-assist";
import { snapReachMm, type SnapExtra, type SnapHit } from "../../lib/map-project-snap";
import type { useMapProjectSnap } from "./use-map-project-snap";

type Snap = ReturnType<typeof useMapProjectSnap>;
type Modifiers = Pick<PointerModifiers, "alt" | "command" | "free" | "pointerType" | "pxPerMm">;

/** Nästa punkt: var den hamnar, punkterna före den längs kanten (följ kant), fästet och om vinkellåset användes. */
export interface DrawStep { readonly at: Point; readonly via: readonly Point[]; readonly hit: SnapHit | undefined; readonly locked: boolean }

const NONE: readonly Point[] = [];
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * K8b V5 (ägaren 2026-11-21): följ kant och vinkellås i Rita (och vinkellåset för Rektangelns andra hörn). Håll Skift när den
 * senaste punkten är fäst på en linje eller ytkant: förhandsvisningen följer kanten till pekaren och klicket lägger in alla
 * punkter. Håll ⌘/Ctrl: sträckan låses i steg mot förra sträckan, kanten eller norr, och fästet går längs den låsta strålen.
 * Tangenterna läses också utan att pekaren rör sig. Geometrin är `lib/map-project-draw-assist.ts`.
 */
export function useMapProjectDrawAssist(input: { snap: Snap; tool: string; points: readonly Point[]; corners: () => readonly Point[];
  setCursor: (at: Point) => void }) {
  const latest = useRef(input);
  latest.current = input;
  /** Fästet där den senaste punkten sattes (gäller bara så länge den är utkastets sista punkt). */
  const remembered = useRef<{ at: Point; hit: SnapHit } | undefined>(undefined);
  const lastHover = useRef<{ point: Point; modifiers: Modifiers; extra: SnapExtra | undefined } | undefined>(undefined);
  const [via, setVia] = useState<readonly Point[]>(NONE);
  const [locked, setLocked] = useState(false);
  const drafting = input.points.length > 0;
  useEffect(() => { if (!drafting) { setVia(NONE); setLocked(false); } }, [drafting, input.tool]);

  function step(point: Point, modifiers: Modifiers, extra: SnapExtra | undefined): DrawStep {
    const { snap, tool } = latest.current;
    const points = tool === "draw" ? latest.current.points : tool === "rectangle" ? latest.current.corners() : NONE;
    const last = points[points.length - 1];
    const start = remembered.current && last && same(remembered.current.at, last) ? remembered.current.hit : undefined;
    const index = snap.index();
    if (tool === "draw" && last && modifiers.free && start && index) {
      const followed = followEdge(index, start, point);
      if (followed) { snap.show(followed.hit); return { at: followed.hit.at, via: followed.points.slice(0, -1), hit: followed.hit, locked: false }; }
    }
    if (modifiers.command && last && (tool === "draw" || (tool === "rectangle" && points.length === 1))) {
      const lock = lockAngle(last, point, angleReference(points, start, index));
      const hit = snap.active(modifiers) ? snapOnRay(index, { origin: last, dir: lock.dir, near: lock.at, reachMm: snapReachMm(modifiers.pointerType, modifiers.pxPerMm),
        hidden: snap.hidden, extra }) : undefined;
      snap.show(hit);
      return { at: hit?.at ?? lock.at, via: NONE, hit, locked: true };
    }
    const hit = snap.hit(point, modifiers, { extra });
    return { at: hit?.at ?? point, via: NONE, hit, locked: false };
  }

  function show(next: DrawStep) {
    setVia(current => current.length === 0 && next.via.length === 0 ? current : next.via);
    setLocked(next.locked);
  }

  /** Pekaren över kartan: punkten där markören ska stå (förhandsvisningens punkter längs kanten sätts här). */
  function hover(point: Point, modifiers: Modifiers, extra: SnapExtra | undefined): Point {
    lastHover.current = { point, modifiers, extra };
    const next = step(point, modifiers, extra);
    show(next);
    return next.at;
  }

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== "Shift" && event.key !== "Meta" && event.key !== "Control")) return;
      const { tool, points, setCursor } = latest.current, hovered = lastHover.current;
      if (!hovered || (tool !== "draw" && tool !== "rectangle")) return;
      const modifiers = { ...hovered.modifiers, free: event.shiftKey, command: event.metaKey || event.ctrlKey };
      lastHover.current = { ...hovered, modifiers };
      const next = step(hovered.point, modifiers, hovered.extra);
      show(next);
      if (tool === "draw" && points.length) setCursor(next.at);
    };
    const release = () => setLocked(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", update); window.removeEventListener("keyup", update); window.removeEventListener("blur", release); };
  }, []);

  return {
    step, hover, via, locked,
    /** Punkten sattes (klick eller dragstart): fästet minns för följ kant och vinkellåset. */
    remember: (at: Point, hit: SnapHit | undefined) => { remembered.current = hit ? { at, hit } : undefined; },
    leave: () => { lastHover.current = undefined; }
  };
}
