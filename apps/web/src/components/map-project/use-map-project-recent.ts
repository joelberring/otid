"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { withRecent } from "../../lib/map-project-shape-actions";

const recentKey = (projectId: string) => `otid-map-recent:${projectId}`;

/**
 * Ägaren 2026-11-09: de senaste symbolerna per kartprojekt (sparade i webbläsaren), i raden Senaste och i hjulet. Utbrutet ur
 * `map-project-editor.tsx` (K8b V5). `shown` är symbolerna som finns i katalogen, i ordning.
 */
export function useMapProjectRecent<T>(projectId: string, symbols: ReadonlyMap<string, T>) {
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem(recentKey(projectId)) ?? "[]") as unknown; if (Array.isArray(stored)) setRecent(stored.filter(id => typeof id === "string").slice(0, 9)); }
    catch { /* utan lagring: inga senaste */ }
  }, [projectId]);
  const remember = useCallback((id: string) => setRecent(current => {
    const next = withRecent(current, id);
    try { localStorage.setItem(recentKey(projectId), JSON.stringify(next)); } catch { /* utan lagring */ }
    return next;
  }), [projectId]);
  const shown = useMemo(() => recent.map(id => symbols.get(id)).filter((entry): entry is T => entry !== undefined), [recent, symbols]);
  return { recent, remember, shown };
}
