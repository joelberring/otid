"use client";

import type { MapObject, Point } from "@o-tid/map-file";
import { withSymbol, type Box, type ObjectKey, type ObjectRef } from "@o-tid/map-revision";
import { useCallback, useMemo, useRef, useState } from "react";
import { translateObject } from "../../lib/map-project-draw";
import { joinLines } from "../../lib/map-project-join";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { angleFrom, boundsOf, centerOf, rotateObject } from "../../lib/map-project-transform";
import type { ObjectChange } from "./use-map-project-editor";

export interface MultiItem { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }
type MultiDrag =
  | { readonly mode: "marquee"; readonly start: Point }
  | { readonly mode: "move"; readonly start: Point }
  | { readonly mode: "rotate"; readonly center: Point; readonly from: number };
export type MultiZone = "move" | "rotate" | undefined;

/** Markören utanför ett hörn av markeringen: en böjd pil (vrid). */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
  + '<path d="M5 15a8 8 0 0 1 14-5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M5 15a8 8 0 0 1 14-5" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"/>'
  + '<path d="M20 4v7h-7z" fill="#111" stroke="#fff" stroke-width="1"/><path d="M1 13l4 6 5-5z" fill="#111" stroke="#fff" stroke-width="1"/></svg>')}") 12 12, alias`;

/** Så många träffytor utanför ett hörn räknas som "vrid". */
const ROTATE_REACH = 3;

/** En punkt på objektet: var en borttagning ligger (för delområdena när servern bara har objektet i grundfilen). */
export function anchorOf(object: MapObject): Point | undefined {
  if (object.kind === "point" || object.kind === "text") return object.at;
  const first = object.kind === "line" ? object.path[0] : object.rings[0]?.[0];
  return first ? { x: first.x, y: first.y } : undefined;
}

/**
 * Ägaren 2026-11-10 ("markera objekt genom att skapa en fyrkant med musen … som Illustrator, att man kan flytta direkt och att det
 * kommer upp förslag om man drar i hörnet"): flera markerade objekt. En ruta dragen på tom karta markerar det den rör vid; Skift+klick
 * lägger till eller tar bort ett objekt. Ett drag inne i markeringens ruta flyttar allt, ett drag strax utanför ett hörn vrider allt
 * runt rutans mitt. Varje objekt blir en egen ändring (som allt annat synkas och blir förslag), men stegen hör ihop och ångras
 * tillsammans.
 */
export function useMapProjectMulti({ session, hidden, commit, setPreviewKeys }: {
  session: MapProjectSession | undefined; hidden: readonly string[]; commit: (change: ObjectChange) => boolean;
  /** Objekten som dras ritas av sidan under tiden (kartans egna bild av dem göms). */
  setPreviewKeys: (keys: ReadonlySet<ObjectKey>) => void;
}) {
  const [items, setItemsState] = useState<readonly MultiItem[]>([]);
  const itemsRef = useRef<readonly MultiItem[]>([]);
  const setItems = useCallback((next: readonly MultiItem[]) => { itemsRef.current = next; setItemsState(next); }, []);
  const [marquee, setMarquee] = useState<Box>();
  const marqueeRef = useRef<Box | undefined>(undefined);
  const [moved, setMovedState] = useState<readonly MapObject[]>();
  const movedRef = useRef<readonly MapObject[] | undefined>(undefined);
  const setMoved = (next: readonly MapObject[] | undefined) => { movedRef.current = next; setMovedState(next); };
  const [zone, setZone] = useState<MultiZone>();
  const drag = useRef<MultiDrag | undefined>(undefined);
  const shown = useMemo(() => moved ?? items.map(item => item.object), [moved, items]);
  const box = useMemo(() => boundsOf(shown), [shown]);

  /** Var pekaren står i förhållande till markeringens ruta: inne i den (flytta), strax utanför ett hörn (vrid) eller annars. */
  const zoneAt = useCallback((point: Point, tolerance: number): MultiZone => {
    const current = boundsOf(itemsRef.current.map(item => item.object));
    if (!current) return undefined;
    const inside = point.x >= current.minX - tolerance && point.x <= current.maxX + tolerance && point.y >= current.minY - tolerance && point.y <= current.maxY + tolerance;
    if (inside) return "move";
    const reach = tolerance * (1 + ROTATE_REACH);
    const corner = [current.minX, current.maxX].some(x => [current.minY, current.maxY].some(y => Math.hypot(point.x - x, point.y - y) <= reach * Math.SQRT2));
    return corner ? "rotate" : undefined;
  }, []);

  const end = () => { drag.current = undefined; setMoved(undefined); marqueeRef.current = undefined; setMarquee(undefined); setPreviewKeys(new Set()); };

  return {
    items, box, marquee, shown, zone, moving: !!moved, dragging: () => !!drag.current, zoneAt,
    hover: (point: Point | undefined, tolerance: number) => { if (!drag.current) setZone(point ? zoneAt(point, tolerance) : undefined); },
    clear: () => { if (itemsRef.current.length) setItems([]); setZone(undefined); },
    /** Skift+klick: objektet läggs till i markeringen, eller tas ur den om det redan är med. */
    toggle: (item: MultiItem, first?: MultiItem) => {
      const base = itemsRef.current.length || !first ? itemsRef.current : [first];
      setItems(base.some(row => row.key === item.key) ? base.filter(row => row.key !== item.key) : [...base, item]);
    },
    /** Ett drag börjar: flytta eller vrid markeringen. Falskt när pekaren står utanför den. */
    grab: (point: Point, tolerance: number): boolean => {
      const at = zoneAt(point, tolerance);
      const current = boundsOf(itemsRef.current.map(item => item.object));
      if (!at || !current) return false;
      const center = centerOf(current);
      drag.current = at === "move" ? { mode: "move", start: point } : { mode: "rotate", center, from: angleFrom(center, point) };
      setPreviewKeys(new Set(itemsRef.current.map(item => item.key)));
      return true;
    },
    /** Ett drag på tom karta: en ny ruta. */
    startMarquee: (point: Point) => { setItems([]); drag.current = { mode: "marquee", start: point }; },
    dragMove: (point: Point) => {
      const current = drag.current;
      if (!current) return;
      if (current.mode === "marquee") {
        marqueeRef.current = { minX: Math.min(current.start.x, point.x), minY: Math.min(current.start.y, point.y),
          maxX: Math.max(current.start.x, point.x), maxY: Math.max(current.start.y, point.y) };
        setMarquee(marqueeRef.current);
      } else if (current.mode === "move") {
        const by = { x: point.x - current.start.x, y: point.y - current.start.y };
        setMoved(itemsRef.current.map(item => translateObject(item.object, by)));
      } else {
        const degrees = angleFrom(current.center, point) - current.from;
        setMoved(itemsRef.current.map(item => rotateObject(item.object, current.center, degrees)));
      }
    },
    dragEnd: () => {
      const current = drag.current, area = marqueeRef.current, objects = movedRef.current;
      end();
      if (!current) return;
      if (current.mode === "marquee") {
        if (area && session) session.box(area, hidden, hits => setItems(hits.map(hit => ({ key: hit.key, ref: hit.ref, object: hit.object }))));
        return;
      }
      if (!objects) return;
      const group = crypto.randomUUID();
      setItems(itemsRef.current.map((item, index) => {
        const object = objects[index]!;
        return commit({ key: item.key, ref: item.ref, kind: "MOVE", after: { kind: "OBJECT", object }, group }) ? { ...item, object } : item;
      }));
    },
    cancel: end,
    /** Hur många av de markerade som kan få symbolen (samma form, en annan symbol än de har). */
    switchable: (symbol: { id: string; kind: string } | undefined) =>
      symbol ? itemsRef.current.filter(item => item.object.kind === symbol.kind && item.object.symbol !== symbol.id).length : 0,
    /** Ägaren 2026-11-10 («byta egenskaper på flera»): alla markerade med rätt form får den valda symbolen (ett steg att ångra). */
    switchSymbol: (symbol: { id: string; kind: string }): number => {
      const group = crypto.randomUUID();
      let count = 0;
      setItems(itemsRef.current.map(item => {
        if (item.object.kind !== symbol.kind || item.object.symbol === symbol.id) return item;
        const object = withSymbol(item.object, symbol.id);
        if (!commit({ key: item.key, ref: item.ref, kind: "SYMBOL", after: { kind: "OBJECT", object }, group })) return item;
        count += 1;
        return { ...item, object };
      }));
      return count;
    },
    /** Om något av det markerade går att slå ihop (linjer med samma symbol). */
    joinable: (tolerance: number) => itemsRef.current.length >= 2 && !!joinLines(itemsRef.current.map(item => item.object), tolerance),
    /** Slå ihop de markerade linjerna: den första behålls med den nya formen, de andra tas bort (ett steg att ångra). */
    join: (tolerance: number): number => {
      const current = itemsRef.current, result = joinLines(current.map(item => item.object), tolerance);
      if (!result) return 0;
      const group = crypto.randomUUID(), [keep, ...rest] = result.used.map(index => current[index]!);
      if (!keep || !commit({ key: keep.key, ref: keep.ref, kind: "RESHAPE", after: { kind: "OBJECT", object: result.object }, group })) return 0;
      for (const item of rest) commit({ key: item.key, ref: item.ref, kind: "DELETE", after: { kind: "DELETED" }, point: anchorOf(item.object), group });
      const gone = new Set(rest.map(item => item.key));
      setItems(current.filter(item => !gone.has(item.key)).map(item => item.key === keep.key ? { ...item, object: result.object } : item));
      return result.used.length;
    },
    /** Ta bort allt markerat (ett steg att ångra). */
    remove: () => {
      const group = crypto.randomUUID();
      for (const item of itemsRef.current) commit({ key: item.key, ref: item.ref, kind: "DELETE", after: { kind: "DELETED" }, point: anchorOf(item.object), group });
      setItems([]);
    }
  };
}
