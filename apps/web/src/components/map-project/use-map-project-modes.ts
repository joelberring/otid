"use client";

import { useCallback, useEffect, useState } from "react";

/** Glappen som Magisk fyll får sluta (m i terrängen), i ordning för [ och ]. */
export const GAP_STEPS_M = [2, 4, 8, 15] as const;
export const DEFAULT_GAP_M = 4;
const snapKey = (projectId: string) => `otid-map-snap:${projectId}`;
const GAP_KEY = "otid-map-gap";

/** Nästa eller förra glappet i stegen (`]` större, `[` mindre); ett värde utanför stegen går till närmaste. */
export function stepGap(current: number, direction: 1 | -1): number {
  const steps: readonly number[] = GAP_STEPS_M, index = steps.indexOf(current);
  if (index >= 0) return steps[Math.max(0, Math.min(steps.length - 1, index + direction))]!;
  return direction > 0 ? steps.find(step => step > current) ?? steps.at(-1)! : [...steps].reverse().find(step => step < current) ?? steps[0]!;
}

/**
 * K8b V1 (ägaren 2026-11-21): statusradens lägen. Fäst sparas per kartprojekt (förval på för en karta efter sprintnormen
 * ISSprOM, annars av); fästandet är `use-map-project-snap.ts` (V3). Glapp (2/4/8/15 m, förval 4) gäller i hela webbläsaren och läses av
 * Magisk fyll (V2).
 */
export function useMapProjectModes(input: { projectId: string; sprint: boolean }) {
  const { projectId, sprint } = input;
  const [stored, setStored] = useState<boolean>();
  const [gapM, setGap] = useState<number>(DEFAULT_GAP_M);
  useEffect(() => {
    try {
      const snap = localStorage.getItem(snapKey(projectId));
      setStored(snap === "on" ? true : snap === "off" ? false : undefined);
      const gap = Number(localStorage.getItem(GAP_KEY));
      if ((GAP_STEPS_M as readonly number[]).includes(gap)) setGap(gap);
    } catch { /* utan lagring: förvalen */ }
  }, [projectId]);
  const setSnap = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setStored(current => {
      const value = typeof next === "function" ? next(current ?? sprint) : next;
      try { localStorage.setItem(snapKey(projectId), value ? "on" : "off"); } catch { /* utan lagring */ }
      return value;
    });
  }, [projectId, sprint]);
  const setGapM = useCallback((next: number) => {
    setGap(next);
    try { localStorage.setItem(GAP_KEY, String(next)); } catch { /* utan lagring */ }
  }, []);
  return { snap: stored ?? sprint, setSnap, gapM, setGapM };
}
