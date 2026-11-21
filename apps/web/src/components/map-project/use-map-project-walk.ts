"use client";

import { useCallback, useRef, useState } from "react";
import type { MapGeoreference, Point } from "@o-tid/map-file";
import { metersPerMm, toMapPosition } from "../../lib/course-setting-geo";
import type { TimedFix } from "./use-map-project-position";

/**
 * K3 (utbrutet ur `map-project-editor.tsx`): linjen som gås med GPS. Varje position går också till rekningen (`recordFix`);
 * medan en linje gås blir det en ny punkt var 2 m (bättre noggrannhet än så har inte telefonen i skog).
 */
export function useMapProjectWalk(georeference: MapGeoreference | null | undefined, recordFix: (fix: TimedFix) => void) {
  /** Linjen som gås (punkterna i kartans mm), eller undefined. */
  const [walk, setWalk] = useState<readonly Point[]>();
  const walkRef = useRef<readonly Point[] | undefined>(undefined);
  const onFix = useCallback((fix: TimedFix) => {
    recordFix(fix);
    const current = walkRef.current;
    if (!current || !georeference) return;
    let at: Point;
    try { at = toMapPosition(georeference, fix).at; } catch { return; }
    const last = current[current.length - 1];
    if (last && Math.hypot(at.x - last.x, at.y - last.y) * metersPerMm(georeference, georeference.scale) < 2) return;
    walkRef.current = [...current, at];
    setWalk(walkRef.current);
  }, [recordFix, georeference]);
  const start = (from: Point | undefined) => { walkRef.current = from ? [from] : []; setWalk(walkRef.current); };
  /** Slutar gå och ger punkterna. */
  const stop = (): readonly Point[] => { const points = walkRef.current ?? []; walkRef.current = undefined; setWalk(undefined); return points; };
  return { walk, onFix, start, stop };
}
